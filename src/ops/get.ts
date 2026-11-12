import { parseHandle, resolvePath } from '../refs.js';
import { resultValue } from '../values.js';
import { text, type Op } from './context.js';

export const getOp: Op = {
  def: {
    name: 'pipe__get',
    description:
      'Fetch a stored value by handle instead of asking for it again. Every tool call made through mcp-pipe ' +
      'gets a handle shown as ⟨pipe:cN⟩. Handles: "c3.out" (result), "c3.in" (arguments), with an optional path ' +
      'like "c3.out.rows[0].name" or "c3.in.sql". Special handle "status" lists connected servers and startup errors.',
    inputSchema: {
      type: 'object',
      properties: { handle: { type: 'string', description: 'e.g. "c3.out.rows[0]" or "status"' } },
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
