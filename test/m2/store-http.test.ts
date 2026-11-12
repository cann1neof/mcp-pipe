import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DownstreamPool } from '../../src/downstream.js';
import { serveHttp } from '../../src/http.js';
import { MemoryStore } from '../../src/store/memory.js';
import { SqliteStore } from '../../src/store/sqlite.js';
import { fixtureServer } from '../helpers.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-m2-')), 'store.db');
const base = { session: 's', server: 'echo', tool: 'echo', args: {} };

describe('store retention', () => {
  it('purge deletes calls and runs older than the cutoff', () => {
    for (const s of [new MemoryStore(), new SqliteStore(tmp())]) {
      const c = s.putCall(base);
      const r = s.putRun({ session: 's', chain: { steps: [] }, params: {}, steps: {}, status: 'defined' });
      expect(s.purge(Date.now() - 1000)).toBe(0);
      expect(s.purge(Date.now() + 1000)).toBe(2);
      expect(s.getCall(c.id)).toBeUndefined();
      expect(s.getRun(r.id)).toBeUndefined();
      s.close();
    }
  });
  it('ttl purge on open', () => {
    const p = tmp();
    const a = new SqliteStore(p);
    const { id } = a.putCall(base);
    a.close();
    const b = new SqliteStore(p, { ttlDays: 1e-9 });
    expect(b.getCall(id)).toBeUndefined();
    b.close();
  });
  it('hiddenFrom persists in sqlite', () => {
    const s = new SqliteStore(tmp());
    const { id } = s.putCall(base);
    s.finishCall(id, { content: [] }, false, ['hr']);
    expect(s.getCall(id)!.hiddenFrom).toEqual(['hr']);
    s.close();
  });
});

describe('host over HTTP', () => {
  it('serves tools at /mcp, one session per client', async () => {
    const config = { mcpServers: { echo: fixtureServer('echo-server') } };
    const pool = await DownstreamPool.start(config);
    const srv = await serveHttp({ pool, store: new MemoryStore(), config, port: 0 });
    try {
      const client = new Client({ name: 'h', version: '0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(srv.url)));
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(['echo__echo', 'pipe__map']));
      const r = (await client.callTool({ name: 'echo__echo', arguments: { text: 'hi' } })) as any;
      expect(r.content[0].text).toBe('hi');
      await client.close();
    } finally {
      await srv.close();
      await pool.close();
    }
  });
});
