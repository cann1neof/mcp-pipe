import { transform } from '../jq.js';
import { parseRefExpr } from '../refs.js';
import { shapeOf } from '../values.js';
import { json, text, type Op } from './context.js';

export const getOp: Op = {
  def: {
    name: 'pipe__get',
    description:
      'Read the arguments or the result of an earlier tool call by its handle. ' +
      'Handle forms: "c3.out" (result), "c3.in" (arguments); add a path to read part of a value, ' +
      'e.g. "c3.out.items[0].id". Optional "jq" applies a jq filter to the value first. ' +
      '"status" returns the connected servers and any startup errors.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'call handle with optional path, or "status"' },
        jq: { type: 'string', description: 'optional jq filter applied to the value' },
      },
      required: ['handle'],
    },
    annotations: { readOnlyHint: true },
  },
  async handle(args, core) {
    const h = String(args.handle ?? '').trim();
    if (h === 'status') {
      return json({ servers: core.pool.servers(), tools: core.pool.tools().length, errors: core.pool.errors() });
    }
    const expr = parseRefExpr(h.replace(/^\{\{\s*|\s*\}\}$/g, ''));
    const call = /^(c\d+)\./.exec(expr.name)?.[1];
    if (call) {
      const rec = core.store.getCall(call);
      if (rec && core.isHidden(rec) && expr.name.endsWith('.out')) throw new Error(`${call} is hidden by policy`);
    }
    const t = await core.evalExpr(h);
    if (t.hiddenFrom?.length) throw new Error(`${call ?? h} is hidden by policy`);
    let v = t.value;
    if (typeof args.jq === 'string' && args.jq.trim()) {
      try {
        v = await transform(v, args.jq);
      } catch (e) {
        throw new Error(`${(e as Error).message} (input: ${shapeOf(t.value)})`);
      }
    }
    return text(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  },
};
