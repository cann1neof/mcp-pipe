// Host-facing streamable HTTP: one proxy (and one store session) per MCP session.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { DownstreamPool } from './downstream.js';
import { createProxy } from './proxy.js';
import type { Store } from './store/store.js';
import type { PipeConfig } from './types.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export async function serveHttp(o: { pool: DownstreamPool; store: Store; config: PipeConfig; port: number; host?: string }) {
  const host = o.host ?? '127.0.0.1';
  const transports = new Map<string, StreamableHTTPServerTransport>();
  let port = o.port;

  const srv = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== '/mcp') { res.writeHead(404).end('mcp-pipe: use /mcp'); return; }
      const sid = req.headers['mcp-session-id'] as string | undefined;
      let t = sid ? transports.get(sid) : undefined;
      if (!t) {
        if (sid) { res.writeHead(404).end('unknown session'); return; }
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => { transports.set(id, transport); },
          // Block DNS rebinding when bound to loopback: only local Host headers are accepted.
          ...(LOOPBACK.has(host) ? {
            enableDnsRebindingProtection: true,
            allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`],
          } : {}),
        });
        transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
        const server = createProxy(o.pool, o.store, { session: randomUUID(), config: o.config });
        await server.connect(transport);
        t = transport;
      }
      await t.handleRequest(req, res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(`mcp-pipe: ${(e as Error).message}`);
    }
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(o.port, host, () => resolve());
  });
  port = (srv.address() as AddressInfo).port;
  return {
    url: `http://${host.includes(':') ? `[${host}]` : host}:${port}/mcp`,
    close: () => new Promise<void>((r) => {
      for (const t of transports.values()) void t.close();
      srv.closeAllConnections();
      srv.close(() => r());
    }),
  };
}
