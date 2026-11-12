import type { PipeCore } from '../core.js';
import type { RefTarget } from '../refs.js';
import { gate, isWrite, type PlanStep } from '../security.js';
import { errorText, resultValue, shapeOf } from '../values.js';
import { json, type Op } from './context.js';

export type MapResult = {
  outputs: unknown[];
  handles: string[];
  failed: { index: number; error: string }[];
  hiddenFrom: string[];
};

/**
 * Calls `tool` once per item with `args` (which may use {{ item }}, {{ item.path }}), at most `concurrency` at a time.
 * `done` maps item index → call id of an already finished item (skipped; its stored output is reused).
 */
export async function runMap(o: {
  core: PipeCore;
  tool: string;
  items: unknown[];
  itemsHiddenFrom?: string[];
  args: Record<string, unknown>;
  concurrency?: number;
  parent: string;
  extra?: (name: string) => RefTarget | undefined;
  done?: Record<number, string>;
  onItemDone?: (index: number, callId: string) => void;
}): Promise<MapResult> {
  const { core, items } = o;
  const target = core.target(o.tool);
  const outputs: unknown[] = new Array(items.length).fill(null);
  const handles: string[] = new Array(items.length).fill('');
  const failed: MapResult['failed'] = [];
  const hidden = new Set<string>(o.itemsHiddenFrom ?? []);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const prev = o.done?.[i];
      if (prev) {
        const rec = core.store.getCall(prev);
        if (rec?.result && !rec.isError) {
          outputs[i] = resultValue(rec.result);
          handles[i] = prev;
          rec.hiddenFrom?.forEach((s) => hidden.add(s));
          continue;
        }
      }
      const itemTarget: RefTarget = { value: items[i], ...(o.itemsHiddenFrom?.length ? { hiddenFrom: o.itemsHiddenFrom } : {}) };
      const rec = await core.invoke({
        server: target.server, tool: target.tool, args: o.args, parent: o.parent,
        resolver: core.resolver((n) => (n === 'item' ? itemTarget : o.extra?.(n))),
      });
      handles[i] = rec.id;
      rec.hiddenFrom?.forEach((s) => hidden.add(s));
      if (rec.isError) failed.push({ index: i, error: core.visibleError(rec, errorText(rec.result!)) });
      else {
        outputs[i] = resultValue(rec.result!);
        o.onItemDone?.(i, rec.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(o.concurrency ?? 4, Math.max(items.length, 1)) }, worker));
  failed.sort((a, b) => a.index - b.index);
  return { outputs, handles, failed, hiddenFrom: [...hidden] };
}

/** Summary of a map for the AI: counts, failures and handles — never the outputs. */
export function mapSummary(core: PipeCore, r: MapResult, hiddenShapeNone: boolean) {
  if (hiddenShapeNone) return { done: true, anyFailed: r.failed.length > 0 };
  return { ok: r.handles.length - r.failed.length, failed: r.failed, handles: r.handles };
}

export const mapOp: Op = {
  def: {
    name: 'pipe__map',
    description:
      'Call one tool once per item of a stored list, in a single request. "over" is a handle of a list ' +
      '(e.g. "c3.out.rows", or "{{ c3.out | map(.id) }}"). In "args", "{{ item }}" is the current item and ' +
      '"{{ item.<path> }}" part of it. Returns how many calls succeeded, the failures, and a handle per call; ' +
      'the outputs are stored as a list under the map\'s own handle. Tools that can change data need a confirm: ' +
      'the first reply is the plan and a token, then repeat the call with "confirm". "dry_run" returns the plan only.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'tool name as listed, e.g. "server__tool"' },
        over: { type: 'string', description: 'handle of the list to iterate' },
        args: { type: 'object', description: 'arguments for each call; may use {{ item }} refs' },
        concurrency: { type: 'number', description: 'parallel calls (default 4)' },
        dry_run: { type: 'boolean' },
        confirm: { type: 'string', description: 'token from a needs_confirm reply' },
      },
      required: ['tool', 'over', 'args'],
    },
  },
  async handle(args, core) {
    const tool = String(args.tool ?? '');
    const over = String(args.over ?? '');
    const callArgs = (args.args ?? {}) as Record<string, unknown>;
    if (typeof callArgs !== 'object' || Array.isArray(callArgs)) throw new Error('"args" must be an object');
    const target = core.target(tool);
    const list = await core.evalExpr(over);
    if (!Array.isArray(list.value)) {
      throw new Error(`"over" must be a list; ${over} is ${shapeOf(list.value, list.hiddenFrom?.length ? 'types' : 'full')}`);
    }
    if (list.hiddenFrom?.length) core.checkSinks(list.hiddenFrom, target.server);
    const plan: PlanStep[] = [{ tool, count: list.value.length, writes: isWrite(target.def), sampleArgs: callArgs }];
    if (args.dry_run === true) return json({ status: 'dry_run', plan });
    const needs = gate(core.confirms, plan, typeof args.confirm === 'string' ? args.confirm : undefined);
    if (needs) return json(needs);

    const concurrency = typeof args.concurrency === 'number' ? Math.max(1, Math.min(32, Math.floor(args.concurrency))) : 4;
    const mapRec = core.store.putCall({ session: core.session, server: 'pipe', tool: 'map', args: { tool, over, args: callArgs, concurrency } });
    const r = await runMap({ core, tool, items: list.value, itemsHiddenFrom: list.hiddenFrom, args: callArgs, concurrency, parent: mapRec.id });
    core.store.finishCall(mapRec.id, { content: [{ type: 'text', text: JSON.stringify(r.outputs) }] }, false, r.hiddenFrom);
    const rec = core.store.getCall(mapRec.id)!;
    const hiddenNone = core.isHidden(rec) && core.viewPolicy(rec).shape === 'none';
    return json({ ...mapSummary(core, r, hiddenNone), outputs: `${rec.id}.out` }, rec.id);
  },
};
