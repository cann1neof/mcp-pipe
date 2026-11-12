import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, texts } from '../harness.js';
import { fixtureServer } from '../helpers.js';

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => {
  h = await startHarness({ echo: fixtureServer('echo-server'), bad: { command: 'nonexistent-bin-xyz' } });
});
afterAll(async () => { await h.close(); });

const handleOf = (r: any) => texts(r).at(-1)!.slice(6, -1);

describe('pipe__get', () => {
  it('gets out paths and in args', async () => {
    const r = await h.call('echo__json', { value: { rows: [{ name: 'Ann' }] } });
    const id = handleOf(r);
    expect(texts(await h.call('pipe__get', { handle: `${id}.out.rows[0].name` }))[0]).toBe('Ann');
    expect(JSON.parse(texts(await h.call('pipe__get', { handle: `${id}.in` }))[0]!)).toEqual({ value: { rows: [{ name: 'Ann' }] } });
  });
  it('bad path lists available keys', async () => {
    const id = handleOf(await h.call('echo__json', { value: { rows: [], total: 0 } }));
    const r = await h.call('pipe__get', { handle: `${id}.out.rowz` });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/available: rows, total/);
  });
  it('unknown call', async () => {
    const r = await h.call('pipe__get', { handle: 'c999.out' });
    expect(texts(r)[0]).toMatch(/unknown handle c999/);
  });
  it('status shows startup errors', async () => {
    const s = JSON.parse(texts(await h.call('pipe__get', { handle: 'status' }))[0]!);
    expect(s.servers).toContain('echo');
    expect(s.errors.bad).toBeDefined();
  });
});
