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
    if (await ignoresInput(filter, out)) {
      throw new Error('the jq filter gives the same output whatever its input, so it does not transform "from"; ' +
        'a literal value can be passed directly as a tool argument');
    }
    const rec = core.recordInternal('transform', { from, jq: filter }, out, input.hiddenFrom);
    return core.respond(rec);
  },
};

/** True when the filter returns `out` for unrelated inputs too, i.e. it is a constant. Errors count as "depends on input". */
async function ignoresInput(filter: string, out: unknown): Promise<boolean> {
  const same = JSON.stringify(out);
  for (const probe of [null, 0, 'mcp-pipe-probe', [7], { 'mcp-pipe-probe': 7 }]) {
    try {
      if (JSON.stringify(await transform(probe, filter)) !== same) return false;
    } catch {
      return false;
    }
  }
  return true;
}
