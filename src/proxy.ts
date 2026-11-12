import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DownstreamPool, DownstreamTool } from './downstream.js';
import type { Store } from './store/store.js';
import type { CallRecord, CallToolResult } from './types.js';
import { VERSION } from './version.js';
import { text, type Op, type OpContext } from './ops/context.js';
import { getOp } from './ops/get.js';
import { patchOp } from './ops/patch.js';

export const marker = (id: string) => `⟨pipe:${id}⟩`;

const INSTRUCTIONS =
  'Every tool result from this server ends with a handle like ⟨pipe:c3⟩ that refers to the stored call ' +
  '(its arguments and its result). pipe__patch re-runs a stored call with modified arguments; ' +
  'pipe__get reads a stored call\'s arguments or result, or part of them.';

export const OPS: Op[] = [getOp, patchOp];

export function createProxy(pool: DownstreamPool, store: Store, opts: { session: string }): Server {
  const server = new Server(
    { name: 'mcp-pipe', version: VERSION },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  const index = new Map<string, DownstreamTool>(pool.tools().map((t) => [t.name, t]));
  const ops = new Map(OPS.map((o) => [o.def.name, o]));

  const execute = async (rec: CallRecord): Promise<CallToolResult> => {
    let result: CallToolResult;
    try {
      result = await pool.call(rec.server, rec.tool, rec.args);
    } catch (e) {
      result = { isError: true, content: [{ type: 'text', text: `mcp-pipe: call failed: ${(e as Error).message}` }] };
    }
    const isError = result.isError === true;
    store.finishCall(rec.id, result, isError);
    return { ...result, content: [...(result.content ?? []), { type: 'text', text: marker(rec.id) }] };
  };
  const ctx: OpContext = { pool, store, session: opts.session, execute };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const downstream: Tool[] = pool.tools().map((t) => ({ ...t.def, name: t.name }));
    return { tools: [...downstream, ...OPS.map((o) => o.def)] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name } = req.params;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const op = ops.get(name);
    if (op) {
      try {
        return await op.handle(args, ctx);
      } catch (e) {
        return text(`${name}: ${(e as Error).message}`, true);
      }
    }
    const target = index.get(name);
    if (!target) return text(`mcp-pipe: unknown tool "${name}"`, true);
    const rec = store.putCall({ session: opts.session, server: target.server, tool: target.tool, args });
    return execute(rec);
  });

  return server;
}
