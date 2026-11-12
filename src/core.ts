// The proxy core: executes calls with {{ }} refs resolved, tracks blind-mode taint, and builds what the host sees.
import type { DownstreamPool, DownstreamTool } from './downstream.js';
import type { Store } from './store/store.js';
import type { CallRecord, CallToolResult, PipeConfig } from './types.js';
import { evalExpr, hasRefs, substituteRefs, type RefTarget, type Resolver } from './refs.js';
import { maskError, policyFor, strictest, type ResolvedPolicy } from './policy.js';
import { ConfirmTokens } from './security.js';
import { errorText, hasBinary, preview, resultValue, shapeOf, textBytes } from './values.js';

export const marker = (id: string) => `⟨pipe:${id}⟩`;
export const DEFAULT_PEEK_BYTES = 8192;

export class RefusedError extends Error {}

export const textResult = (t: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: t }],
  ...(isError ? { isError: true } : {}),
});

const union = (...lists: (string[] | undefined)[]) => [...new Set(lists.flatMap((l) => l ?? []))];

export class PipeCore {
  readonly index = new Map<string, DownstreamTool>();
  readonly confirms = new ConfirmTokens();

  constructor(
    readonly pool: DownstreamPool,
    readonly store: Store,
    readonly cfg: PipeConfig,
    readonly session: string,
  ) {
    for (const t of pool.tools()) this.index.set(t.name, t);
  }

  policy(server: string, tool?: string): ResolvedPolicy {
    return policyFor(this.cfg, server, tool);
  }

  /** A downstream tool by its exposed name (`server__tool`). */
  target(name: string): DownstreamTool {
    const t = this.index.get(name);
    if (!t) {
      const names = [...this.index.keys()];
      throw new Error(`unknown tool "${name}"; available: ${names.slice(0, 40).join(', ')}${names.length > 40 ? ', …' : ''}`);
    }
    return t;
  }

  /** The value behind a stored call: its arguments ("in") or its result ("out"). */
  callValue(id: string, side: 'in' | 'out'): RefTarget {
    const rec = this.store.getCall(id);
    if (!rec) throw new Error(`unknown handle ${id}`);
    if (side === 'in') return { value: rec.args };
    if (!rec.result) throw new Error(`${id} has no result yet (not run, or still running)`);
    if (rec.isError) throw new Error(`${id} failed, so it has no value to use; fix it with pipe__patch first`);
    return { value: resultValue(rec.result), ...(rec.hiddenFrom?.length ? { hiddenFrom: rec.hiddenFrom } : {}) };
  }

  /** Resolver for handles (`c3.out`, `c3.in`); `extra` handles other names (params, steps, item). */
  resolver(extra?: (name: string) => RefTarget | undefined): Resolver {
    return (name) => {
      const h = /^(c\d+)\.(in|out)$/.exec(name);
      if (h) return this.callValue(h[1]!, h[2] as 'in' | 'out');
      const t = extra?.(name);
      if (t) return t;
      throw new Error(`unknown handle ${name}`);
    };
  }

  async evalExpr(expr: string, resolver = this.resolver()): Promise<RefTarget> {
    return evalExpr(expr, resolver);
  }

  /** Blind-mode sink rule: hidden data may only flow to servers its source allows. */
  checkSinks(hiddenFrom: string[], targetServer: string): void {
    for (const src of hiddenFrom) {
      if (src === targetServer) continue;
      const sinks = this.policy(src).allowSinks;
      if (sinks && !sinks.includes(targetServer)) {
        throw new RefusedError(`refused: hidden data from "${src}" may not be sent to "${targetServer}" (allowed: ${sinks.join(', ') || 'none'})`);
      }
    }
  }

  /** Records a pipe-internal call (transform, map, ai input/output) with a computed value. */
  recordInternal(tool: string, args: unknown, value: unknown, hiddenFrom: string[] = [], parent?: string): CallRecord {
    const rec = this.store.putCall({ session: this.session, server: 'pipe', tool, args, ...(parent ? { parent } : {}) });
    this.store.finishCall(rec.id, textResult(JSON.stringify(value ?? null)), false, hiddenFrom);
    return this.store.getCall(rec.id)!;
  }

  /**
   * Records and runs one downstream call. `args` are stored as given (refs included, so patches edit refs,
   * not data); refs are resolved just before forwarding. Never throws: failures become isError results.
   */
  async invoke(o: { server: string; tool: string; args: unknown; parent?: string; resolver?: Resolver }): Promise<CallRecord> {
    const rec = this.store.putCall({
      session: this.session, server: o.server, tool: o.tool, args: o.args ?? {}, ...(o.parent ? { parent: o.parent } : {}),
    });
    let result: CallToolResult;
    let hiddenFrom: string[] = [];
    try {
      let args: unknown = o.args ?? {};
      let wholeRefs: { expr: string; value: unknown }[] = [];
      if (hasRefs(args)) {
        const r = await substituteRefs(args, o.resolver ?? this.resolver());
        args = r.value;
        hiddenFrom = r.hiddenFrom;
        wholeRefs = r.wholeRefs;
        this.checkSinks(hiddenFrom, o.server);
      }
      result = await this.pool.call(o.server, o.tool, args);
      if (result.isError && wholeRefs.length && !hiddenFrom.length) {
        const hint = wholeRefs.map((w) => `{{ ${w.expr} }} resolved to ${shapeOf(w.value)}`).join('; ');
        result = { ...result, content: [...(result.content ?? []), { type: 'text', text: `(mcp-pipe: ${hint})` }] };
      }
      if (this.policy(o.server, o.tool).visibility === 'hidden') hiddenFrom = union(hiddenFrom, [o.server]);
    } catch (e) {
      const msg = (e as Error).message;
      result = textResult(e instanceof RefusedError ? `mcp-pipe: ${msg}` : `mcp-pipe: call failed: ${msg}`, true);
      // A refused call never ran, so its result carries no data; the refusal names servers only.
      if (e instanceof RefusedError) hiddenFrom = [];
    }
    this.store.finishCall(rec.id, result, result.isError === true, hiddenFrom);
    return this.store.getCall(rec.id)!;
  }

  /** The policy that governs what the AI sees of a record (strictest of all hidden sources). */
  viewPolicy(rec: CallRecord): ResolvedPolicy {
    return strictest((rec.hiddenFrom ?? []).map((s) => (s === rec.server ? this.policy(s, rec.tool) : this.policy(s))));
  }

  isHidden(rec: CallRecord): boolean {
    return (rec.hiddenFrom?.length ?? 0) > 0;
  }

  /** An error message as the AI may see it for this record. */
  visibleError(rec: CallRecord, text: string): string {
    if (!this.isHidden(rec)) return text;
    return this.viewPolicy(rec).errors === 'full' ? text : maskError(text);
  }

  /** What the host sees for a finished record: blind summary, a peek preview, or the full result — plus the handle. */
  respond(rec: CallRecord): CallToolResult {
    const m = { type: 'text' as const, text: marker(rec.id) };
    const result = rec.result ?? textResult('(no result)', true);
    if (this.isHidden(rec)) {
      const pol = this.viewPolicy(rec);
      if (rec.isError) return textResult(`${m.text} hidden · error: ${this.visibleError(rec, errorText(result))}`, true);
      const shape = pol.shape === 'none' ? '' : ` · ${shapeOf(resultValue(result), pol.shape === 'types' ? 'types' : 'full')}`;
      return textResult(`${m.text} hidden${shape}`);
    }
    const max = this.cfg.peek?.maxBytes ?? DEFAULT_PEEK_BYTES;
    if (!rec.isError && max > 0 && !hasBinary(result) && textBytes(result) > max) {
      return {
        content: [
          { type: 'text', text: `${preview(resultValue(result))}\n(result is ${textBytes(result)} bytes; full value: pipe__get {"handle":"${rec.id}.out"})` },
          m,
        ],
      };
    }
    const { structuredContent, ...rest } = result;
    // A failed downstream call is usually fixed by changing one argument: say how, so the retry carries only the change.
    const hint = rec.isError && rec.server !== 'pipe'
      ? [{ type: 'text' as const, text: `To retry with changed arguments, send only the change: pipe__patch {"call":"${rec.id}","edits":[{"find":"…","replace":"…"}]}` }]
      : [];
    return { ...rest, ...(structuredContent !== undefined ? { structuredContent } : {}), content: [...(result.content ?? []), ...hint, m] };
  }
}
