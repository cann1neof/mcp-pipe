import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DownstreamPool } from './downstream.js';
import type { Store } from './store/store.js';
import type { PipeConfig } from './types.js';
import { VERSION } from './version.js';
import { PipeCore, textResult } from './core.js';
import { exposeTool } from './schema.js';
import type { Op } from './ops/context.js';
import { getOp } from './ops/get.js';
import { transformOp } from './ops/transform.js';
import { mapOp } from './ops/map.js';
import { patchAnyOp, resumeOp, runOp } from './ops/chain.js';

export { marker } from './core.js';

const INSTRUCTIONS =
  'Every tool result ends with "saved as {{ cN.out }}". Pass saved results to other tools as arguments ' +
  '("{{ c3.out }}", "{{ c3.out.rows }}", "{{ c3.out | <jq> }}") instead of copying data; compute derived values ' +
  '(percentages, totals, formatting) in the query or with jq over the saved result. pipe__patch repeats a call with ' +
  'only the changed arguments. pipe__run executes several steps as one pipe (tool calls, jq, per-item calls).';

export const OPS: Op[] = [getOp, patchAnyOp, transformOp, mapOp, runOp, resumeOp];

export function createProxy(
  pool: DownstreamPool,
  store: Store,
  opts: { session: string; config?: PipeConfig; ops?: Op[]; instructions?: string },
): Server {
  const ops = opts.ops ?? OPS;
  const server = new Server(
    { name: 'mcp-pipe', version: VERSION },
    { capabilities: { tools: {} }, instructions: opts.instructions ?? INSTRUCTIONS },
  );
  const core = new PipeCore(pool, store, opts.config ?? { mcpServers: {} }, opts.session);
  const byName = new Map(ops.map((o) => [o.def.name, o]));

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const downstream: Tool[] = pool.tools().map((t) => exposeTool(t.def, t.name));
    return { tools: [...downstream, ...ops.map((o) => o.def)] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const op = byName.get(name);
    if (op) {
      try {
        return await op.handle(args, core);
      } catch (e) {
        return textResult(`${name}: ${(e as Error).message}`, true);
      }
    }
    const target = core.index.get(name);
    if (!target) return textResult(`mcp-pipe: unknown tool "${name}"`, true);
    const rec = await core.invoke({ server: target.server, tool: target.tool, args });
    return core.respond(rec);
  });

  return server;
}
