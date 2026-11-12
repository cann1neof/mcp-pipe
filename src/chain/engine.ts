// Runs chains step by step. Every step's output is a stored call (so it has a handle); runs persist in the store,
// stop at failures (status failed) and at `ai` steps (status paused), and can be patched and re-run from any step.
import type { PipeCore } from '../core.js';
import { transform } from '../jq.js';
import { substituteRefs, type RefTarget } from '../refs.js';
import { gate, isWrite, type PlanStep } from '../security.js';
import type { RunRecord, StepState } from '../store/store.js';
import type { CallRecord } from '../types.js';
import { errorText, resultValue, shapeOf, textBytes } from '../values.js';
import { runMap } from '../ops/map.js';
import { applyEdits, type Edit } from '../ops/patch.js';
import { checkExpect, normalizeOutput } from './expect.js';
import {
  jqVars, parseChain, refNames, stepKind,
  type AiStep, type CallStep, type Chain, type JqStep, type MapStep, type ParamType, type Step,
} from './schema.js';

export type RunReply = Record<string, unknown> & { status: string; run: string };

const typeOf = (v: unknown): ParamType | 'null' =>
  v === null || v === undefined ? 'null' : Array.isArray(v) ? 'array' : (typeof v as ParamType);

/** Checks params against the chain's declared types. Errors before any step runs. */
export function checkParams(chain: Chain, params: Record<string, unknown>): void {
  for (const [name, type] of Object.entries(chain.params ?? {})) {
    if (!(name in params)) throw new Error(`missing param "${name}" (${type})`);
    const got = typeOf(params[name]);
    if (got !== type) throw new Error(`param "${name}" must be ${type}, got ${got}`);
  }
  const unknown = Object.keys(params).filter((p) => !(p in (chain.params ?? {})));
  if (unknown.length && chain.params) throw new Error(`unknown param${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
}

class StepFailure extends Error {}

export class Engine {
  constructor(readonly core: PipeCore) {}

  define(chainSrc: string | object, params: Record<string, unknown> = {}): RunRecord {
    const chain = parseChain(chainSrc);
    checkParams(chain, params);
    const steps: Record<string, StepState> = {};
    for (const s of chain.steps) steps[s.id] = { status: 'pending' };
    return this.core.store.putRun({ session: this.core.session, chain, params, steps, status: 'defined' });
  }

  getRun(id: string): RunRecord {
    const r = this.core.store.getRun(String(id ?? '').trim());
    if (!r) throw new Error(`unknown run ${id}`);
    return r;
  }

  /** What will execute, for confirms and dry runs. Map counts are unknown until the list is resolved. */
  plan(r: RunRecord, from?: string): PlanStep[] {
    const start = from ? r.chain.steps.findIndex((s) => s.id === from) : 0;
    return r.chain.steps.slice(Math.max(start, 0))
      .filter((s) => r.steps[s.id]?.status !== 'done')
      .map((s): PlanStep => {
        const kind = stepKind(s);
        if (kind === 'call') {
          const c = s as CallStep;
          return { step: s.id, tool: c.call, count: 1, writes: isWrite(this.core.index.get(c.call)?.def), sampleArgs: c.args ?? {} };
        }
        if (kind === 'map') {
          const m = s as MapStep;
          return { step: s.id, tool: m.map, count: -1, writes: isWrite(this.core.index.get(m.map)?.def), sampleArgs: m.args ?? {} };
        }
        return { step: s.id, tool: kind === 'jq' ? 'pipe:jq' : 'pipe:ai', count: 1, writes: false };
      });
  }

  /** Output of a finished step as a ref target. */
  private stepOutput(r: RunRecord, id: string): RefTarget | undefined {
    const st = r.steps[id];
    if (!st || st.status !== 'done' || !st.callId) return undefined;
    const rec = this.core.store.getCall(st.callId);
    if (!rec?.result) return undefined;
    return { value: resultValue(rec.result), ...(rec.hiddenFrom?.length ? { hiddenFrom: rec.hiddenFrom } : {}) };
  }

  private extra(r: RunRecord) {
    return (name: string): RefTarget | undefined => {
      if (name in r.params) return { value: r.params[name] };
      return this.stepOutput(r, name);
    };
  }

  /** jq variables for a program: params and finished steps it mentions. Returns taint too. */
  private varsFor(r: RunRecord, src: string): { vars: Record<string, unknown>; hiddenFrom: string[] } {
    const vars: Record<string, unknown> = {};
    const hidden = new Set<string>();
    for (const n of jqVars(src)) {
      const t = this.extra(r)(n);
      if (!t) throw new StepFailure(`$${n} is not available (no such param, or step "${n}" has not finished)`);
      vars[n] = t.value;
      t.hiddenFrom?.forEach((h) => hidden.add(h));
    }
    return { vars, hiddenFrom: [...hidden] };
  }

  private outputs(r: RunRecord): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of r.chain.steps) if (r.steps[s.id]?.callId) out[s.id] = `${r.steps[s.id]!.callId}.out`;
    return out;
  }

  private save(r: RunRecord): void {
    this.core.store.updateRun(r);
  }

  /** Runs pending steps (optionally starting again from `from`). */
  async run(id: string, opts: { from?: string; confirm?: string; dryRun?: boolean; force?: boolean } = {}): Promise<RunReply> {
    const r = this.getRun(id);
    const order = r.chain.steps.map((s) => s.id);
    if (opts.from !== undefined) {
      const at = order.indexOf(opts.from);
      if (at < 0) throw new Error(`run ${r.id} has no step "${opts.from}"; steps: ${order.join(', ')}`);
      const notDone = order.slice(0, at).filter((s) => r.steps[s]!.status !== 'done');
      if (notDone.length) throw new Error(`cannot run from "${opts.from}": earlier step${notDone.length > 1 ? 's' : ''} ${notDone.join(', ')} not done`);
      for (const s of order.slice(at)) {
        const prev = r.steps[s]!;
        r.steps[s] = { status: 'pending', ...(prev.items && !opts.force ? { items: prev.items } : {}) };
      }
      r.status = 'defined';
    } else if (opts.force) {
      for (const s of order) if (r.steps[s]!.status !== 'done') delete r.steps[s]!.items;
    }
    if (r.status === 'paused') return this.pausedReply(r, order.find((s) => r.steps[s]!.status === 'paused')!);
    if (r.status === 'done') return { status: 'done', run: r.id, outputs: this.outputs(r), note: 'run already finished; use "from" to run steps again' };

    const plan = this.plan(r, opts.from);
    if (opts.dryRun) return { status: 'dry_run', run: r.id, plan };
    if (!r.approved) {
      const needs = gate(this.core.confirms, plan, opts.confirm);
      if (needs) { this.save(r); return { ...needs, run: r.id }; }
      if (plan.some((p) => p.writes)) r.approved = true; // one confirm covers the run until its chain is patched
    }

    r.status = 'running';
    this.save(r);
    let last: CallRecord | undefined;
    for (const step of r.chain.steps) {
      const st = r.steps[step.id]!;
      if (st.status === 'done') { if (st.callId) last = this.core.store.getCall(st.callId); continue; }
      try {
        const kind = stepKind(step);
        if (kind === 'ai') {
          this.pause(r, step as AiStep, await this.aiInput(r, step as AiStep));
          return this.pausedReply(r, step.id);
        }
        last = await this.exec(r, step);
        r.steps[step.id] = { ...r.steps[step.id], status: 'done', callId: last.id };
        delete r.steps[step.id]!.error;
        this.save(r);
      } catch (e) {
        const msg = (e as Error).message;
        r.steps[step.id] = { ...r.steps[step.id], status: 'failed', error: msg };
        r.status = 'failed';
        this.save(r);
        return {
          status: 'failed', run: r.id, step: step.id, error: msg, outputs: this.outputs(r),
          next: `fix it with pipe__patch {"run":"${r.id}","step":"${step.id}","edits":[…]} (re-runs from that step)`,
        };
      }
    }
    r.status = 'done';
    this.save(r);
    return { status: 'done', run: r.id, outputs: this.outputs(r), ...this.resultView(last) };
  }

  /** The final step's value, if it is small and visible; otherwise its shape and handle. */
  private resultView(rec: CallRecord | undefined): Record<string, unknown> {
    if (!rec?.result) return {};
    if (this.core.isHidden(rec)) {
      const pol = this.core.viewPolicy(rec);
      return { result: `hidden${pol.shape === 'none' ? '' : ` · ${shapeOf(resultValue(rec.result), pol.shape === 'types' ? 'types' : 'full')}`}` };
    }
    const max = this.core.cfg.peek?.maxBytes ?? 8192;
    const v = resultValue(rec.result);
    if (max > 0 && textBytes(rec.result) > max) return { result: `shape: ${shapeOf(v)} (read it with pipe__get {"handle":"${rec.id}.out"})` };
    return { result: v };
  }

  private async exec(r: RunRecord, step: Step): Promise<CallRecord> {
    const core = this.core;
    const resolver = core.resolver(this.extra(r));
    switch (stepKind(step)) {
      case 'call': {
        const s = step as CallStep;
        const t = core.target(s.call);
        const rec = await core.invoke({ server: t.server, tool: t.tool, args: s.args ?? {}, resolver });
        if (rec.isError) throw new StepFailure(core.visibleError(rec, errorText(rec.result!)));
        return rec;
      }
      case 'jq': {
        const s = step as JqStep;
        const { vars, hiddenFrom } = this.varsFor(r, s.jq);
        let out: unknown;
        try {
          out = await transform(null, s.jq, vars);
        } catch (e) {
          throw new StepFailure(`jq: ${(e as Error).message}`);
        }
        return core.recordInternal('jq', { run: r.id, step: s.id, jq: s.jq }, out, hiddenFrom);
      }
      case 'map': {
        const s = step as MapStep;
        const t = core.target(s.map);
        const over = await core.evalExpr(s.over, resolver);
        if (!Array.isArray(over.value)) throw new StepFailure(`"over" must be a list; ${s.over} is ${shapeOf(over.value, over.hiddenFrom?.length ? 'types' : 'full')}`);
        if (over.hiddenFrom?.length) core.checkSinks(over.hiddenFrom, t.server);
        const mapRec = core.store.putCall({ session: core.session, server: 'pipe', tool: 'map', args: { run: r.id, step: s.id } });
        const st = r.steps[s.id]!;
        st.items ??= {};
        const res = await runMap({
          core, tool: s.map, items: over.value, itemsHiddenFrom: over.hiddenFrom, args: s.args ?? {},
          concurrency: s.concurrency, parent: mapRec.id, extra: this.extra(r), done: st.items,
          onItemDone: (i, callId) => { st.items![i] = callId; this.save(r); },
        });
        core.store.finishCall(mapRec.id, { content: [{ type: 'text', text: JSON.stringify(res.outputs) }] }, false, res.hiddenFrom);
        if (res.failed.length) {
          const first = res.failed[0]!;
          throw new StepFailure(`${res.failed.length} of ${over.value.length} items failed (first: item ${first.index}: ${first.error}); ` +
            `finished items are kept and skipped on re-run`);
        }
        return core.store.getCall(mapRec.id)!;
      }
      default:
        throw new Error(`step kind ${stepKind(step)} is not executable here`);
    }
  }

  // ---- ai steps ----------------------------------------------------------

  private async aiInput(r: RunRecord, s: AiStep): Promise<RefTarget> {
    let input: RefTarget = { value: null };
    if (s.input) {
      const { vars, hiddenFrom } = this.varsFor(r, s.input);
      try {
        input = { value: await transform(null, s.input, vars), hiddenFrom };
      } catch (e) {
        throw new StepFailure(`input jq: ${(e as Error).message}`);
      }
    }
    const textRefs = [...refNames(s.ai)].map((n) => this.extra(r)(n)).filter(Boolean) as RefTarget[];
    if (input.hiddenFrom?.length || textRefs.some((t) => t.hiddenFrom?.length)) {
      throw new StepFailure('ai step cannot read hidden data (blind mode); keep hidden values in call/jq/map steps');
    }
    return input;
  }

  private pause(r: RunRecord, s: AiStep, input: RefTarget): void {
    const chunks: unknown[] = s.batch && Array.isArray(input.value)
      ? Array.from({ length: Math.max(1, Math.ceil(input.value.length / s.batch)) }, (_, i) => (input.value as unknown[]).slice(i * s.batch!, (i + 1) * s.batch!))
      : [input.value];
    const inputs = chunks.map((c, i) => this.core.recordInternal('ai-input', { run: r.id, step: s.id, chunk: i }, c).id);
    r.steps[s.id] = { status: 'paused', chunks: { inputs, done: {} } };
    r.status = 'paused';
    this.save(r);
  }

  private async pausedReply(r: RunRecord, stepId: string): Promise<RunReply> {
    const s = r.chain.steps.find((x) => x.id === stepId) as AiStep;
    const st = r.steps[stepId]!;
    const by = s.by ?? 'session';
    const task = (await substituteRefs(s.ai, this.core.resolver(this.extra(r)))).value as string;
    const multi = (st.chunks?.inputs.length ?? 1) > 1;
    const chunks = (st.chunks?.inputs ?? []).map((callId, index) => {
      const done = index in (st.chunks?.done ?? {});
      const entry: Record<string, unknown> = { index, inputHandle: `${callId}.out`, done };
      if (by === 'session' && !done) {
        const rec = this.core.store.getCall(callId);
        entry.input = rec?.result ? resultValue(rec.result) : null;
      }
      return entry;
    });
    const resumeCall = `pipe__resume({"run":"${r.id}","step":"${stepId}",${multi ? '"chunk":<index>,' : ''}"output":<result>})`;
    const next = by === 'subagent'
      ? `Spawn a subagent${multi ? ' per open chunk (they can run in parallel)' : ''}. It reads its input with pipe__get({"handle":"<inputHandle>"}), does the task, then calls ${resumeCall}.`
      : `Do the task on ${multi ? 'each open chunk\'s' : 'the'} input, then call ${resumeCall}.`;
    return {
      status: 'paused', run: r.id, step: stepId, by, task,
      ...(s.expect ? { expect: s.expect } : {}),
      ...(multi ? { chunks } : { inputHandle: chunks[0]?.inputHandle, ...(by === 'session' ? { input: chunks[0]?.input } : {}) }),
      next,
    };
  }

  async resume(id: string, stepId: string, chunk: number | undefined, rawOutput: unknown): Promise<RunReply> {
    const r = this.getRun(id);
    const st = r.steps[stepId];
    if (!st) throw new Error(`run ${r.id} has no step "${stepId}"`);
    if (r.status !== 'paused' || st.status !== 'paused' || !st.chunks) {
      throw new Error(`run ${r.id} is not paused at "${stepId}" (run is ${r.status}, step is ${st.status})`);
    }
    const total = st.chunks.inputs.length;
    const index = chunk ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= total) throw new Error(`chunk must be 0…${total - 1}`);
    if (chunk === undefined && total > 1) throw new Error(`step "${stepId}" has ${total} chunks; pass "chunk"`);
    if (index in st.chunks.done) throw new Error(`chunk ${index} of "${stepId}" was already resumed`);

    const s = r.chain.steps.find((x) => x.id === stepId) as AiStep;
    const output = normalizeOutput(rawOutput);
    const inputRec = this.core.store.getCall(st.chunks.inputs[index]!);
    const chunkInput = inputRec?.result ? resultValue(inputRec.result) : null;
    const sameAs = typeof s.expect?.sameLengthAs === 'string' ? s.expect.sameLengthAs : undefined;
    let expectedLen: number | undefined;
    if (sameAs) {
      if (total > 1) expectedLen = Array.isArray(chunkInput) ? chunkInput.length : undefined;
      else {
        const ref = this.extra(r)(sameAs)?.value;
        expectedLen = Array.isArray(ref) ? ref.length : undefined;
      }
    }
    const { sameLengthAs: _x, ...schema } = s.expect ?? {};
    // With chunks, the schema describes the whole output; check each chunk's items against `items` only.
    const chunkSchema = total > 1 && schema.type === 'array' ? { type: 'array', ...(schema.items ? { items: schema.items } : {}) } : schema;
    const reason = checkExpect(output, s.expect ? { ...chunkSchema } : undefined, expectedLen);
    if (reason) return { status: 'rejected', run: r.id, step: stepId, ...(total > 1 ? { chunk: index } : {}), reason, note: 'the run is still paused; resume again with a corrected output' };

    st.chunks.done[index] = this.core.recordInternal('ai-output', { run: r.id, step: stepId, chunk: index }, output).id;
    const open = st.chunks.inputs.map((_, i) => i).filter((i) => !(i in st.chunks!.done));
    if (open.length) {
      this.save(r);
      return { status: 'paused', run: r.id, step: stepId, resumed: index, openChunks: open };
    }
    const parts = st.chunks.inputs.map((_, i) => {
      const rec = this.core.store.getCall(st.chunks!.done[i]!);
      return rec?.result ? resultValue(rec.result) : null;
    });
    const combined = total === 1 ? parts[0] : parts.every(Array.isArray) ? (parts as unknown[][]).flat() : parts;
    if (total > 1 && sameAs) {
      const ref = this.extra(r)(sameAs)?.value;
      if (Array.isArray(ref) && Array.isArray(combined) && ref.length !== combined.length) {
        return { status: 'rejected', run: r.id, step: stepId, reason: `combined output has ${combined.length} items, expected ${ref.length}` };
      }
    }
    const outRec = this.core.recordInternal('ai', { run: r.id, step: stepId }, combined);
    r.steps[stepId] = { status: 'done', callId: outRec.id };
    r.status = 'running';
    this.save(r);
    return this.run(r.id, {});
  }

  // ---- patching steps -----------------------------------------------------

  /** Applies edits to a step (its args / jq / input / ai text / over), re-validates, and resets it and later steps. */
  patchStep(id: string, stepId: string, edits: Edit[]): RunRecord {
    const r = this.getRun(id);
    const at = r.chain.steps.findIndex((s) => s.id === stepId);
    if (at < 0) throw new Error(`run ${r.id} has no step "${stepId}"; steps: ${r.chain.steps.map((s) => s.id).join(', ')}`);
    const { id: _keep, ...body } = r.chain.steps[at]!;
    const patched = applyEdits(body, edits) as Record<string, unknown>;
    const steps = r.chain.steps.map((s, i) => (i === at ? { id: stepId, ...patched } : s));
    const chain = parseChain({ ...r.chain, steps });
    r.chain = chain;
    r.approved = false;
    for (const s of chain.steps.slice(at)) {
      const prev = r.steps[s.id] ?? { status: 'pending' };
      r.steps[s.id] = { status: 'pending', ...(prev.items ? { items: prev.items } : {}) };
    }
    r.status = 'defined';
    this.save(r);
    return r;
  }
}
