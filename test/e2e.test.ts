// End-to-end: the real CLI over stdio, wrapping the demo SQLite server, as a host would run it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixtureServer, root, tsxBin } from './helpers.js';
import { texts } from './harness.js';

let client: Client;
let dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-e2e-'));
  const cfg = path.join(dir, 'servers.json');
  fs.writeFileSync(cfg, JSON.stringify({
    mcpServers: { db: fixtureServer('sqlite-server') },
    store: { path: path.join(dir, 'store.db') },
  }));
  client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StdioClientTransport({ command: tsxBin, args: [path.join(root, 'src/cli.ts'), '--config', cfg] }));
});
afterAll(async () => { await client.close(); });

describe('e2e: SQL fix via patch', () => {
  it('broken query → patch → rows', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['db__query', 'pipe__patch', 'pipe__get']));
    const bad = (await client.callTool({ name: 'db__query', arguments: {
      sql: 'SELECT u.country, COUNT(*) AS n FROM users u JOIN orders o ON o.user_id = u.usr_id GROUP BY u.country ORDER BY u.country',
    } })) as any;
    expect(bad.isError).toBe(true);
    expect(texts(bad)[0]).toMatch(/usr_id/);
    const id = texts(bad).at(-1)!.slice(6, -1);
    const fixed = (await client.callTool({ name: 'pipe__patch', arguments: { call: id, edits: [{ find: 'usr_id', replace: 'user_id' }] } })) as any;
    expect(fixed.isError).toBeFalsy();
    const rows = JSON.parse(texts(fixed)[0]!);
    expect(rows).toHaveLength(5);
    expect(rows.reduce((s: number, r: any) => s + r.n, 0)).toBe(500);
    expect(fs.statSync(path.join(dir, 'store.db')).mode & 0o777).toBe(0o600);
  });
});
