import { describe, it, expect, afterEach } from 'vitest';
import { DownstreamPool } from '../src/downstream.js';
import { fixtureServer } from './helpers.js';
import { startHttpEcho } from './fixtures/http-echo.js';

let pool: DownstreamPool | undefined;
afterEach(async () => { await pool?.close(); pool = undefined; });

describe('DownstreamPool', () => {
  it('lists echo tools namespaced', async () => {
    pool = await DownstreamPool.start({ mcpServers: { echo: fixtureServer('echo-server') } });
    expect(pool.tools().map((t) => t.name)).toContain('echo__echo');
  });
  it('bad server does not block others', async () => {
    pool = await DownstreamPool.start({
      mcpServers: { bad: { command: 'nonexistent-bin-xyz' }, echo: fixtureServer('echo-server') },
    });
    expect(pool.tools().some((t) => t.server === 'echo')).toBe(true);
    expect(pool.errors().bad).toBeDefined();
  });
  it('call routes to server', async () => {
    pool = await DownstreamPool.start({ mcpServers: { echo: fixtureServer('echo-server') } });
    const r = await pool.call('echo', 'echo', { text: 'yo' });
    expect((r.content[0] as any).text).toBe('yo');
  });
  it('url entry connects over streamable HTTP and sends headers', async () => {
    const srv = await startHttpEcho({ requireAuth: 'Bearer t0k' });
    try {
      pool = await DownstreamPool.start({ mcpServers: { web: { url: srv.url, headers: { Authorization: 'Bearer t0k' } } } });
      expect(pool.errors()).toEqual({});
      expect(pool.tools().map((t) => t.name)).toContain('web__echo');
      const r = await pool.call('web', 'echo', { text: 'over http' });
      expect((r.content[0] as any).text).toBe('over http');
      expect(srv.seenAuth.every((a) => a === 'Bearer t0k')).toBe(true);
    } finally { await pool?.close(); pool = undefined; await srv.close(); }
  });
  it('unreachable url → error entry, others fine', async () => {
    pool = await DownstreamPool.start({ mcpServers: { web: { url: 'http://127.0.0.1:9/mcp' }, echo: fixtureServer('echo-server') } });
    expect(pool.errors().web).toBeDefined();
    expect(pool.tools().some((t) => t.server === 'echo')).toBe(true);
  });
});
