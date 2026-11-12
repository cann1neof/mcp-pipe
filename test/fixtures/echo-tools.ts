// Tools of the deterministic test server (shared by the stdio and the in-process HTTP fixture).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const RO = { readOnlyHint: true };
const txt = (text: string) => ({ content: [{ type: 'text' as const, text }] });

export function registerEcho(server: McpServer): void {
  let inflight = 0;
  let maxInflight = 0;
  const calls: Record<string, number> = {};
  const count = (n: string) => { calls[n] = (calls[n] ?? 0) + 1; };

  server.registerTool('echo', { description: 'Echo text back', inputSchema: { text: z.string() } },
    async ({ text }) => { count('echo'); return txt(text); });

  server.registerTool('fail', { description: 'Always fails', inputSchema: {} },
    async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }));

  server.registerTool('json', { description: 'Return value as JSON text', inputSchema: { value: z.any() } },
    async ({ value }) => { count('json'); return txt(JSON.stringify(value)); });

  server.registerTool('image', { description: 'Return a 1px PNG', inputSchema: {} },
    async () => ({ content: [{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }] }));

  server.registerTool('slow', { description: 'Wait ms then reply', inputSchema: { ms: z.number() } },
    async ({ ms }) => {
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, ms));
      inflight--;
      return txt(`waited ${ms}`);
    });

  server.registerTool('rows', { description: 'n rows', inputSchema: { n: z.number() }, annotations: RO },
    async ({ n }) => { count('rows'); return txt(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `row-${i + 1}` })))); });

  server.registerTool('lookup', { description: 'Secret record by key', inputSchema: { key: z.string() }, annotations: RO },
    async ({ key }) => { count('lookup'); return txt(JSON.stringify({ key, secret: `s3cr3t-${key}`, salary: 123456 })); });

  server.registerTool('sum', { description: 'Sum numbers', inputSchema: { values: z.array(z.number()) }, annotations: RO },
    async ({ values }) => txt(String(values.reduce((a, b) => a + b, 0))));

  server.registerTool('bad_sql', { description: 'Fails with values in the message', inputSchema: { q: z.string() }, annotations: RO },
    async ({ q }) => ({ isError: true, content: [{ type: 'text', text: `syntax error near 'salary = 123456' in "${q}"\nline 2 details` }] }));

  server.registerTool('stats', { description: 'Call counters and max in-flight', inputSchema: {}, annotations: RO },
    async () => txt(JSON.stringify({ calls, maxInflight })));
}
