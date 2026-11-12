import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, texts } from './harness.js';
import { resultValue } from '../src/values.js';

let h: Awaited<ReturnType<typeof startHarness>>;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

describe('proxy', () => {
  it('tools/list = downstream tools + pipe tools', async () => {
    const names = (await h.client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['echo__echo', 'echo__fail', 'pipe__get', 'pipe__patch']));
    const echo = (await h.client.listTools()).tools.find((t) => t.name === 'echo__echo')!;
    expect(echo.inputSchema.properties).toHaveProperty('text');
  });
  it('echo__echo returns hi plus marker', async () => {
    const r = await h.call('echo__echo', { text: 'hi' });
    const t = texts(r);
    expect(t[0]).toBe('hi');
    expect(t[1]).toMatch(/^saved as \{\{ c\d+\.out \}\}$/);
    expect(r.content).toHaveLength(2);
  });
  it('call is recorded with args and result', async () => {
    const r = await h.call('echo__echo', { text: 'rec' });
    const id = texts(r).at(-1)!.match(/\{\{ (c\d+)\.out/)![1]!;
    const rec = h.store.getCall(id)!;
    expect(rec.args).toEqual({ text: 'rec' });
    expect(rec.server).toBe('echo');
    expect(rec.session).toBe('test');
    expect(resultValue(rec.result!)).toBe('rec');
  });
  it('isError passes through and is recorded', async () => {
    const r = await h.call('echo__fail');
    expect(r.isError).toBe(true);
    const id = texts(r).at(-1)!.match(/\{\{ (c\d+)\.out/)![1]!;
    expect(h.store.getCall(id)!.isError).toBe(true);
  });
  it('image content passes through byte-identical', async () => {
    const r = await h.call('echo__image');
    expect(r.content[0].type).toBe('image');
    expect(r.content[0].data).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  });
  it('unknown tool → error', async () => {
    const r = await h.call('nope__x');
    expect(r.isError).toBe(true);
  });
  it('parallel calls get unique handles', async () => {
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => h.call('echo__echo', { text: `p${i}` })));
    const ids = rs.map((r) => texts(r).at(-1));
    expect(new Set(ids).size).toBe(20);
  });
});

describe('resultValue', () => {
  it('parses JSON text', () => expect(resultValue({ content: [{ type: 'text', text: '{"a":1}' }] })).toEqual({ a: 1 }));
  it('keeps plain text', () => expect(resultValue({ content: [{ type: 'text', text: 'hello' }] })).toBe('hello'));
  it('prefers structuredContent', () => expect(resultValue({ content: [], structuredContent: { x: 1 } })).toEqual({ x: 1 }));
});
