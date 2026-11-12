import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { toolName } from './naming.js';
import type { PipeConfig, ServerConfig } from './types.js';
import { VERSION } from './version.js';

export type DownstreamTool = { name: string; server: string; tool: string; def: Tool };

const CONNECT_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function connect(name: string, cfg: ServerConfig): Promise<{ client: Client; tools: Tool[] }> {
  if ('url' in cfg) throw new Error('http downstream servers come in M2; use a stdio server for now');
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) },
    cwd: cfg.cwd,
    stderr: 'inherit',
  });
  const client = new Client({ name: `mcp-pipe→${name}`, version: VERSION });
  try {
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, 'connect');
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await withTimeout(client.listTools(cursor ? { cursor } : {}), CONNECT_TIMEOUT_MS, 'tools/list');
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return { client, tools };
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
}

export class DownstreamPool {
  private clients = new Map<string, Client>();
  private toolList: DownstreamTool[] = [];
  private errs: Record<string, string> = {};

  private constructor() {}

  /** Connects to all servers in parallel. One failing server never blocks the others. */
  static async start(cfg: PipeConfig): Promise<DownstreamPool> {
    const pool = new DownstreamPool();
    const names = Object.keys(cfg.mcpServers).sort();
    const results = await Promise.allSettled(names.map((n) => connect(n, cfg.mcpServers[n]!)));
    const taken = new Set<string>();
    results.forEach((r, i) => {
      const server = names[i]!;
      if (r.status === 'rejected') {
        pool.errs[server] = r.reason instanceof Error ? r.reason.message : String(r.reason);
        return;
      }
      pool.clients.set(server, r.value.client);
      for (const def of r.value.tools) {
        if (server === 'pipe') continue; // reserved namespace
        pool.toolList.push({ name: toolName(server, def.name, taken), server, tool: def.name, def });
      }
    });
    if (cfg.mcpServers.pipe) pool.errs.pipe = 'server name "pipe" is reserved by mcp-pipe; rename it';
    return pool;
  }

  tools(): DownstreamTool[] { return this.toolList; }
  servers(): string[] { return [...this.clients.keys()]; }
  errors(): Record<string, string> { return { ...this.errs }; }

  async call(server: string, tool: string, args: unknown): Promise<CallToolResult> {
    const client = this.clients.get(server);
    if (!client) throw new Error(`server "${server}" is not connected${this.errs[server] ? `: ${this.errs[server]}` : ''}`);
    return (await client.callTool({ name: tool, arguments: (args ?? {}) as Record<string, unknown> })) as CallToolResult;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.clients.values()].map((c) => c.close()));
    this.clients.clear();
  }
}
