import { describe, it, expect, afterEach } from 'vitest';
import { DownstreamPool } from '../src/downstream.js';
import { fixtureServer } from './helpers.js';

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
  it('http entries report a clear error', async () => {
    pool = await DownstreamPool.start({ mcpServers: { web: { url: 'https://example.com/mcp' } } });
    expect(pool.errors().web).toMatch(/M2/);
  });
});
