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
import { defineOp, patchAnyOp, recipesOp, resumeOp, runOp, saveOp } from './ops/chain.js';

export { marker } from './core.js';

const INSTRUCTIONS =
  'Every tool result from this server ends with a handle like ⟨pipe:c3⟩ that refers to the stored call ' +
  '(its arguments and its result). Any argument of any tool may be a reference "{{ c3.out.path | jq }}" to a ' +
  'stored value, so data can move between tools without being copied. pipe__patch re-runs a stored call with ' +
  'modified arguments; pipe__get reads a stored value or part of it; pipe__transform reshapes one with jq; ' +
  'pipe__map calls a tool once per item of a stored list. For work with several steps, pipe__run executes a whole ' +
  'plan (a chain of tool calls, jq steps, per-item calls and pauses for judgement) in one request; working plans ' +
  'can be saved as recipes (pipe__save) and run again by name.';

export const OPS: Op[] = [getOp, patchAnyOp, transformOp, mapOp, runOp, defineOp, resumeOp, saveOp, recipesOp];

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
