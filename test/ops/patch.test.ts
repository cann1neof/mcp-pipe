import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, texts } from '../harness.js';

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

const handleOf = (r: any) => texts(r).at(-1)!.match(/\{\{ (c\d+)\.out/)![1]!;

describe('pipe__patch', () => {
  it('find/replace in string leaves, new id with parent', async () => {
    const c1 = handleOf(await h.call('echo__echo', { text: 'SELECT usr_id FROM users WHERE usr_id > 1' }));
    const r = await h.call('pipe__patch', { call: c1, edits: [{ find: 'usr_id', replace: 'user_id' }] });
    expect(texts(r)[0]).toBe('SELECT user_id FROM users WHERE user_id > 1');
    const c2 = handleOf(r);
    expect(c2).not.toBe(c1);
    expect(h.store.getCall(c2)!.parent).toBe(c1);
  });
  it('path limits replacement to one field', async () => {
    const c = handleOf(await h.call('echo__json', { value: { a: 'x', b: 'x' } }));
    const r = await h.call('pipe__patch', { call: c, edits: [{ path: 'value.a', find: 'x', replace: 'y' }] });
    expect(JSON.parse(texts(r)[0]!)).toEqual({ a: 'y', b: 'x' });
  });
  it('set replaces a value', async () => {
    const c = handleOf(await h.call('echo__json', { value: { n: 1 } }));
    const r = await h.call('pipe__patch', { call: c, edits: [{ path: 'value.n', set: 42 }] });
    expect(JSON.parse(texts(r)[0]!)).toEqual({ n: 42 });
  });
  it('no match → error, no new call', async () => {
    const c = handleOf(await h.call('echo__echo', { text: 'abc' }));
    const before = h.store.putCall({ session: 's', server: 'echo', tool: 'echo', args: {} }).id;
    const r = await h.call('pipe__patch', { call: c, edits: [{ find: 'zzz', replace: 'y' }] });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/no match for "zzz"/);
    const after = h.store.putCall({ session: 's', server: 'echo', tool: 'echo', args: {} }).id;
    expect(Number(after.slice(1))).toBe(Number(before.slice(1)) + 1);
  });
  it('run:false creates call without executing', async () => {
    const c = handleOf(await h.call('echo__echo', { text: 'abc' }));
    const r = await h.call('pipe__patch', { call: c, edits: [{ find: 'a', replace: 'A' }], run: false });
    const id = /created (c\d+)/.exec(texts(r)[0]!)![1]!;
    const rec = h.store.getCall(id)!;
    expect(rec.args).toEqual({ text: 'Abc' });
    expect(rec.result).toBeUndefined();
  });
  it('no edits reruns as-is', async () => {
    const c = handleOf(await h.call('echo__echo', { text: 'again' }));
    const r = await h.call('pipe__patch', { call: c });
    expect(texts(r)[0]).toBe('again');
    expect(handleOf(r)).not.toBe(c);
  });
});
