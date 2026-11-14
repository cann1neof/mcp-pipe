import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startHarness, texts, handleOf, body } from '../harness.js';
import { fixtureServer } from '../helpers.js';

describe('refs in direct calls', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => { h = await startHarness(); });
  afterAll(async () => { await h.close(); });

  it('pipes one call\'s output into another\'s array argument (schema widened)', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 4 }));
    const r = await h.call('echo__sum', { values: `{{ ${rows}.out | map(.id) }}` });
    expect(texts(r)[0]).toBe('10');
    const def = (await h.client.listTools()).tools.find((t) => t.name === 'echo__sum')!;
    expect(JSON.stringify(def.inputSchema)).toMatch(/anyOf/);
    expect(def.outputSchema).toBeUndefined();
  });
  it('stored args keep the ref string, so patch edits refs', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 3 }));
    const c = handleOf(await h.call('echo__sum', { values: `{{ ${rows}.out | map(.id) }}` }));
    expect(h.store.getCall(c)!.args).toEqual({ values: `{{ ${rows}.out | map(.id) }}` });
    const p = await h.call('pipe__patch', { call: c, edits: [{ find: 'map(.id)', replace: 'map(.id * 10)' }] });
    expect(texts(p)[0]).toBe('60');
  });
  it('an array argument sent as JSON text is parsed before forwarding and stored parsed', async () => {
    const r = await h.call('echo__sum', { values: '[1, 2, 3]' });
    expect(r.isError).toBeFalsy();
    expect(texts(r)[0]).toBe('6');
    expect(h.store.getCall(handleOf(r))!.args).toEqual({ values: [1, 2, 3] });
  });
  it('JSON text of the wrong type is forwarded as is (downstream error)', async () => {
    const r = await h.call('echo__sum', { values: '{"a": 1}' });
    expect(r.isError).toBe(true);
  });
  it('a ref can be any jq expression that mentions handles', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 3 }));
    const r = await h.call('echo__sum', { values: `{{ [100] + (${rows}.out | map(.id)) }}` });
    expect(texts(r)[0]).toBe('106');
    const s2 = await h.call('echo__sum', { values: `{{ ${rows}.out | map(.id) | . + [1] }}` });
    expect(texts(s2)[0]).toBe('7');
    const lit = await h.call('echo__echo', { text: '{{ "c1.out" }}' });
    expect(texts(lit)[0]).toMatch(/bad reference/);
  });
  it('embedded ref inside text', async () => {
    const j = handleOf(await h.call('echo__json', { value: { hash: 'deadbeef' } }));
    const r = await h.call('echo__echo', { text: `prefix {{ ${j}.out.hash | .[0:4] }}%` });
    expect(texts(r)[0]).toBe('prefix dead%');
  });
  it('unknown handle → error, nothing forwarded', async () => {
    const before = body(await h.call('echo__stats')).calls.echo ?? 0;
    const r = await h.call('echo__echo', { text: 'Dear {{ name }},' });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/unknown handle name/);
    expect(body(await h.call('echo__stats')).calls.echo ?? 0).toBe(before);
  });
  it('type mismatch gets a hint', async () => {
    const j = handleOf(await h.call('echo__json', { value: { a: 1 } }));
    const r = await h.call('echo__sum', { values: `{{ ${j}.out }}` });
    expect(r.isError).toBe(true);
    expect(texts(r).join('\n')).toMatch(/resolved to \{a:number\}/);
  });
  it('ref to a failed call is refused', async () => {
    const f = handleOf(await h.call('echo__fail'));
    const r = await h.call('echo__echo', { text: `{{ ${f}.out }}` });
    expect(texts(r)[0]).toMatch(/failed, so it has no value/);
  });
});

describe('pipe__get / pipe__transform', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => { h = await startHarness(); });
  afterAll(async () => { await h.close(); });

  it('get with jq', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 3 }));
    expect(texts(await h.call('pipe__get', { handle: `${rows}.out`, jq: 'map(.name) | join(",")' }))[0]).toBe('row-1,row-2,row-3');
  });
  it('transform stores output under a new handle', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 3 }));
    const t = await h.call('pipe__transform', { from: `${rows}.out`, jq: 'map({k: .name})' });
    const id = handleOf(t);
    expect(JSON.parse(texts(t)[0]!)).toEqual([{ k: 'row-1' }, { k: 'row-2' }, { k: 'row-3' }]);
    expect(texts(await h.call('echo__echo', { text: `{{ ${id}.out[2].k }}` }))[0]).toBe('row-3');
  });
  it('a filter that ignores its input is refused', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 2 }));
    const t = await h.call('pipe__transform', { from: `${rows}.out`, jq: '[["a", 1], ["b", 2]]' });
    expect(t.isError).toBe(true);
    expect(texts(t)[0]).toMatch(/same output whatever its input/);
    const ok = await h.call('pipe__transform', { from: `${rows}.out`, jq: '[["id"]] + map([.id])' });
    expect(JSON.parse(texts(ok)[0]!)).toEqual([['id'], [1], [2]]);
  });
  it('jq error names the input shape', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 2 }));
    const t = await h.call('pipe__transform', { from: `${rows}.out`, jq: '.foo' });
    expect(t.isError).toBe(true);
    expect(texts(t)[0]).toMatch(/input: array\[2\] of \{id:number,name:string/);
  });
});

describe('pipe__map + confirm', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => { h = await startHarness(undefined, { confirmWrites: true }); });
  afterAll(async () => { await h.close(); });

  it('read-only tool runs at once; outputs stored in order', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 3 }));
    const r = await h.call('pipe__map', { tool: 'echo__lookup', over: `${rows}.out`, args: { key: '{{ item.name }}' } });
    const b = body(r);
    expect(b.ok).toBe(3);
    expect(b.failed).toEqual([]);
    expect(b.handles).toHaveLength(3);
    const outs = JSON.parse(texts(await h.call('pipe__get', { handle: `${handleOf(r)}.out` }))[0]!);
    expect(outs.map((o: any) => o.key)).toEqual(['row-1', 'row-2', 'row-3']);
  });
  it('write tool needs confirm; 0 calls before; token works once', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 3 }));
    const before = body(await h.call('echo__stats')).calls.echo ?? 0;
    const args = { tool: 'echo__echo', over: `${rows}.out`, args: { text: '{{ item.name }}' } };
    const first = body(await h.call('pipe__map', args));
    expect(first.status).toBe('needs_confirm');
    expect(first.plan[0]).toMatchObject({ tool: 'echo__echo', count: 3, writes: true });
    expect(body(await h.call('echo__stats')).calls.echo ?? 0).toBe(before);
    const ok = body(await h.call('pipe__map', { ...args, confirm: first.confirm }));
    expect(ok.ok).toBe(3);
    const again = await h.call('pipe__map', { ...args, confirm: first.confirm });
    expect(texts(again)[0]).toMatch(/already used/);
  });
  it('dry_run returns plan only', async () => {
    const rows = handleOf(await h.call('echo__rows', { n: 2 }));
    const r = body(await h.call('pipe__map', { tool: 'echo__echo', over: `${rows}.out`, args: { text: 'x' }, dry_run: true }));
    expect(r.status).toBe('dry_run');
  });
  it('0 items → ok 0; failing items reported', async () => {
    const empty = handleOf(await h.call('echo__json', { value: [] }));
    expect(body(await h.call('pipe__map', { tool: 'echo__lookup', over: `${empty}.out`, args: { key: 'x' } })).ok).toBe(0);
    const mixed = handleOf(await h.call('echo__json', { value: [1, 2, 3] }));
    const r = body(await h.call('pipe__map', { tool: 'echo__bad_sql', over: `${mixed}.out`, args: { q: '{{ item }}' } }));
    expect(r.ok).toBe(0);
    expect(r.failed.map((f: any) => f.index)).toEqual([0, 1, 2]);
  });
  it('concurrency respected', async () => {
    const items = handleOf(await h.call('echo__json', { value: [1, 2, 3, 4, 5, 6] }));
    const plan = body(await h.call('pipe__map', { tool: 'echo__slow', over: `${items}.out`, args: { ms: 60 }, concurrency: 2 }));
    await h.call('pipe__map', { tool: 'echo__slow', over: `${items}.out`, args: { ms: 60 }, concurrency: 2, confirm: plan.confirm });
    expect(body(await h.call('echo__stats')).maxInflight).toBe(2);
  });
  it('over must be a list', async () => {
    const j = handleOf(await h.call('echo__json', { value: { a: 1 } }));
    expect(texts(await h.call('pipe__map', { tool: 'echo__lookup', over: `${j}.out`, args: { key: 'x' } }))[0]).toMatch(/must be a list/);
  });
});

describe('peek', () => {
  it('large result → preview + handle; get returns full; small unchanged; 0 disables', async () => {
    const h = await startHarness(undefined, { peek: { maxBytes: 500 } });
    try {
      const big = await h.call('echo__rows', { n: 200 });
      expect(texts(big)[0]).toMatch(/^shape: array\[200\]/);
      expect(texts(big)[0]).toMatch(/full value: pipe__get/);
      const full = JSON.parse(texts(await h.call('pipe__get', { handle: `${handleOf(big)}.out` }))[0]!);
      expect(full).toHaveLength(200);
      expect(texts(await h.call('echo__rows', { n: 2 }))[0]).toBe('[{"id":1,"name":"row-1"},{"id":2,"name":"row-2"}]');
    } finally { await h.close(); }
    const off = await startHarness(undefined, { peek: { maxBytes: 0 } });
    try {
      expect(JSON.parse(texts(await off.call('echo__rows', { n: 200 }))[0]!)).toHaveLength(200);
    } finally { await off.close(); }
  });
});

describe('blind mode', () => {
  const SECRET = 's3cr3t-';
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => {
    h = await startHarness({
      hr: { ...fixtureServer('echo-server'), pipe: { visibility: 'hidden', shape: 'types', allowSinks: ['sink'], tools: { rows: { visibility: 'visible' } } } },
      sink: fixtureServer('echo-server'),
      other: fixtureServer('echo-server'),
    }, { confirmWrites: true });
  });
  afterAll(async () => { await h.close(); });
  const all = (r: any) => JSON.stringify(r);

  it('hidden result returns handle + shape only', async () => {
    const r = await h.call('hr__lookup', { key: 'ann' });
    expect(all(r)).not.toContain(SECRET);
    expect(all(r)).not.toContain('123456');
    expect(texts(r)[0]).toMatch(/saved as \{\{ c\d+\.out \}\} hidden · \{key:string,secret:string,salary:number\}/);
  });
  it('per-tool override is visible', async () => {
    expect(texts(await h.call('hr__rows', { n: 1 }))[0]).toBe('[{"id":1,"name":"row-1"}]');
  });
  it('pipe__get on hidden refused', async () => {
    const id = handleOf(await h.call('hr__lookup', { key: 'ann' }));
    const r = await h.call('pipe__get', { handle: `${id}.out.secret` });
    expect(r.isError).toBe(true);
    expect(all(r)).not.toContain(SECRET);
  });
  it('transform of hidden is hidden', async () => {
    const id = handleOf(await h.call('hr__lookup', { key: 'ann' }));
    const t = await h.call('pipe__transform', { from: `${id}.out`, jq: '.secret' });
    expect(all(t)).not.toContain(SECRET);
    expect(texts(t)[0]).toMatch(/hidden · string$/);
  });
  it('into a sink: allowed, result hidden', async () => {
    const id = handleOf(await h.call('hr__lookup', { key: 'ann' }));
    const r = await h.call('sink__echo', { text: `{{ ${id}.out.secret }}` });
    expect(r.isError).toBeFalsy();
    expect(all(r)).not.toContain(SECRET);
    expect(texts(r)[0]).toMatch(/hidden/);
  });
  it('into a non-sink: refused before forwarding', async () => {
    const id = handleOf(await h.call('hr__lookup', { key: 'ann' }));
    const before = body(await h.call('other__stats')).calls.echo ?? 0;
    const r = await h.call('other__echo', { text: `{{ ${id}.out.secret }}` });
    expect(r.isError).toBe(true);
    expect(texts(r)[0]).toMatch(/may not be sent to "other"/);
    expect(body(await h.call('other__stats')).calls.echo ?? 0).toBe(before);
  });
  it('masked error keeps type, drops values', async () => {
    const r = await h.call('hr__bad_sql', { q: 'SELECT salary' });
    expect(r.isError).toBe(true);
    expect(all(r)).not.toContain('123456');
    expect(texts(r)[0]).toMatch(/syntax error near '\*\*\*'/);
  });
  it('map over hidden data: summary only, outputs hidden', async () => {
    const id = handleOf(await h.call('hr__lookup', { key: 'ann' }));
    const list = handleOf(await h.call('pipe__transform', { from: `${id}.out`, jq: '[.secret, .key]' }));
    const r = await h.call('pipe__map', { tool: 'sink__json', over: `${list}.out`, args: { value: '{{ item }}' } });
    const b = body(await h.call('pipe__map', { tool: 'sink__json', over: `${list}.out`, args: { value: '{{ item }}' }, confirm: body(r).confirm }));
    expect(b.ok).toBe(2);
    expect(all(b)).not.toContain(SECRET);
    const g = await h.call('pipe__get', { handle: `${b.handles[0]}.out` });
    expect(g.isError).toBe(true);
  });
  it('patch response on hidden call stays blind', async () => {
    const id = handleOf(await h.call('hr__lookup', { key: 'ann' }));
    const p = await h.call('pipe__patch', { call: id, edits: [{ find: 'ann', replace: 'bob' }] });
    expect(all(p)).not.toContain(SECRET);
  });
  it('blind mode is off by default', async () => {
    expect(texts(await h.call('other__lookup', { key: 'z' }))[0]).toContain(SECRET);
  });
});

describe('blind mode shape none', () => {
  it('hides shape and counts', async () => {
    const h = await startHarness({ hr: { ...fixtureServer('echo-server'), pipe: { visibility: 'hidden', shape: 'none' } } });
    try {
      const r = await h.call('hr__rows', { n: 5 });
      expect(texts(r)[0]).toMatch(/^saved as \{\{ c\d+\.out \}\} hidden$/);
    } finally { await h.close(); }
  });
});
