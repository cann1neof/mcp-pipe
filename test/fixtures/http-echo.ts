// In-process streamable-HTTP MCP server with the echo tools, for HTTP downstream tests.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerEcho } from './echo-tools.js';

export async function startHttpEcho(opts: { requireAuth?: string } = {}) {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const seenAuth: string[] = [];
  const srv = http.createServer(async (req, res) => {
    seenAuth.push(String(req.headers.authorization ?? ''));
    if (opts.requireAuth && req.headers.authorization !== opts.requireAuth) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    const sid = req.headers['mcp-session-id'] as string | undefined;
    let t = sid ? transports.get(sid) : undefined;
    if (!t) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { transports.set(id, transport); },
      });
      const server = new McpServer({ name: 'http-echo', version: '0' });
      registerEcho(server);
      await server.connect(transport);
      t = transport;
    }
    await t.handleRequest(req, res);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    seenAuth,
    close: () => new Promise<void>((r) => { srv.closeAllConnections(); srv.close(() => r()); }),
  };
}
