import { transform } from '../jq.js';
import { shapeOf } from '../values.js';
import type { Op } from './context.js';

export const transformOp: Op = {
  def: {
    name: 'pipe__transform',
    description:
      'Reshape a stored value with a jq filter and store the output under a new handle, without the data ' +
      'passing through the conversation. "from" is a handle with optional path (e.g. "c3.out.items").',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'handle of the input value, e.g. "c3.out"' },
        jq: { type: 'string', description: 'jq filter' },
      },
      required: ['from', 'jq'],
    },
    annotations: { readOnlyHint: true },
  },
  async handle(args, core) {
    const from = String(args.from ?? '');
    const filter = String(args.jq ?? '');
    if (!filter.trim()) throw new Error('"jq" must not be empty');
    const input = await core.evalExpr(from);
    let out: unknown;
    try {
      out = await transform(input.value, filter);
    } catch (e) {
      const shape = input.hiddenFrom?.length ? shapeOf(input.value, 'types') : shapeOf(input.value);
      throw new Error(`${(e as Error).message} (input: ${shape})`);
    }
    const rec = core.recordInternal('transform', { from, jq: filter }, out, input.hiddenFrom);
    return core.respond(rec);
  },
};
