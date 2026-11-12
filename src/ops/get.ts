import { parseHandle, resolvePath } from '../refs.js';
import { resultValue } from '../values.js';
import { text, type Op } from './context.js';

export const getOp: Op = {
  def: {
    name: 'pipe__get',
    description:
      'Read the arguments or the result of an earlier tool call by its handle. ' +
      'Handle forms: "c3.out" (result), "c3.in" (arguments); add a path to read part of a value, ' +
      'e.g. "c3.out.items[0].id". "status" returns the connected servers and any startup errors.',
    inputSchema: {
      type: 'object',
      properties: { handle: { type: 'string', description: 'call handle with optional path, or "status"' } },
      required: ['handle'],
    },
    annotations: { readOnlyHint: true },
  },
  async handle(args, { pool, store }) {
    const h = String(args.handle ?? '').trim();
    if (h === 'status') {
      return text(JSON.stringify({
        servers: pool.servers(),
        tools: pool.tools().length,
        errors: pool.errors(),
      }, null, 2));
    }
    const ref = parseHandle(h);
    const rec = store.getCall(ref.call);
    if (!rec) throw new Error(`unknown handle ${ref.call}`);
    let root: unknown;
    if (ref.side === 'in') root = rec.args;
    else {
      if (!rec.result) throw new Error(`${ref.call} has no result yet (not run or still running)`);
      root = resultValue(rec.result);
    }
    const v = resolvePath(root, ref.path);
    return text(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  },
};
