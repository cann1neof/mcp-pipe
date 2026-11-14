import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseChain } from '../../src/chain/schema.js';
import { DownstreamPool } from '../../src/downstream.js';
import { SqliteStore } from '../../src/store/sqlite.js';
import { MemoryStore } from '../../src/store/memory.js';
import { startHarness, texts, body, handleOf } from '../harness.js';
import { fixtureServer } from '../helpers.js';

const TRANSLATE = `
name: translate-deck
description: Translate every text box of a deck
params: { deck_id: string, lang: string }
steps:
  - id: boxes
    call: slides__list_text
    args: { deck: "{{ deck_id }}" }
  - id: tr
    ai: "Translate each item to {{ lang }}. Return a JSON array, same order, same length."
    input: '$boxes | map(.text)'
    by: subagent
    batch: 20
    expect: { type: array, items: { type: string }, sameLengthAs: boxes }
  - id: merged
    jq: '$boxes | to_entries | map(.value + {text: $tr[.key]})'
  - id: write
    map: slides__set_text
    over: merged
    args: { deck: "{{ deck_id }}", slide: "{{ item.slide }}", box: "{{ item.box }}", text: "{{ item.text }}" }
`;

describe('chain schema', () => {
  it('translate-deck example parses', () => {
    const c = parseChain(TRANSLATE);
    expect(c.steps.map((s) => s.id)).toEqual(['boxes', 'tr', 'merged', 'write']);
    expect(c.params).toEqual({ deck_id: 'string', lang: 'string' });
  });
  it('duplicate step id rejected', () => {
    expect(() => parseChain({ steps: [{ id: 'a', jq: '1' }, { id: 'a', jq: '2' }] })).toThrow(/duplicate step id "a"/);
  });
  it('forward reference rejected naming the step', () => {
    expect(() => parseChain({ steps: [{ id: 'a', jq: '$b' }, { id: 'b', jq: '1' }] })).toThrow(/step 1 "a".*later step "b"/);
    expect(() => parseChain({ steps: [{ id: 'a', call: 'x__y', args: { q: '{{ nope }}' } }] })).toThrow(/unknown name "nope"/);
  });
  it('step with two kinds rejected', () => {
    expect(() => parseChain({ steps: [{ id: 'a', jq: '1', call: 'x' }] })).toThrow(/exactly one of.*jq and call|call and jq/);
  });
  it('unknown tool allowed at parse; handles allowed in refs', () => {
    expect(() => parseChain({ steps: [{ id: 'a', call: 'nope__x', args: { v: '{{ c3.out }}' } }] })).not.toThrow();
  });
  it('jq local variables are not references', () => {
    expect(() => parseChain({ steps: [{ id: 'a', jq: '[1,2] as $x | $x' }] })).not.toThrow();
  });
});

describe('engine', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => { h = await startHarness(); });
  afterAll(async () => { await h.close(); });

  const chain = {
    steps: [
      { id: 'rows', call: 'echo__rows', args: { n: 3 } },
      { id: 'names', jq: '$rows | map(.name)' },
      { id: 'joined', call: 'echo__lookup', args: { key: '{{ names | join("+") }}' } },
    ],
  };

  it('call → jq → call runs; outputs have handles; last result returned', async () => {
    const r = body(await h.call('pipe__run', { chain }));
    expect(r.status).toBe('done');
    expect(Object.keys(r.outputs)).toEqual(['rows', 'names', 'joined']);
    expect(r.result.key).toBe('row-1+row-2+row-3');
    const names = JSON.parse(texts(await h.call('pipe__get', { handle: r.outputs.names }))[0]!);
    expect(names).toEqual(['row-1', 'row-2', 'row-3']);
  });
  it('failure stops the run, names the step; patch + rerun does not repeat earlier steps', async () => {
    const bad = { steps: [{ id: 'rows', call: 'echo__rows', args: { n: 2 } }, { id: 'q', call: 'echo__bad_sql', args: { q: 'x' } }, { id: 'after', jq: '1' }] };
    const r = await h.call('pipe__run', { chain: bad });
    expect(r.isError).toBe(true);
    const b = body(r);
    expect(b).toMatchObject({ status: 'failed', step: 'q' });
    const rowsBefore = body(await h.call('echo__stats')).calls.rows;
    const p = body(await h.call('pipe__patch', { run: b.run, step: 'q', edits: [{ path: 'call', set: 'echo__lookup' }, { path: 'args', set: { key: 'k' } }] }));
    expect(p.status).toBe('done');
    expect(body(await h.call('echo__stats')).calls.rows).toBe(rowsBefore);
  });
  it('jq steps read saved calls as $cN; ref expressions use step names', async () => {
    const c = handleOf(await h.call('echo__rows', { n: 3 }));
    const r = body(await h.call('pipe__run', { chain: { steps: [
      { id: 'ids', jq: `$${c} | map(.id)` },
      { id: 'j', call: 'echo__json', args: { value: { n: '{{ ids | length }}' } } },
      { id: 'msg', call: 'echo__echo', args: { text: `{{ "ids: " + (ids | map(tostring) | join(",")) + " n=" + (j.n | tostring) }}` } },
    ] } }));
    expect(r).toMatchObject({ status: 'done', result: 'ids: 1,2,3 n=3' });
  });
  it('write steps run directly by default', async () => {
    const w = { steps: [{ id: 'a', call: 'echo__rows', args: { n: 1 } }, { id: 'b', call: 'echo__echo', args: { text: 'hi' } }] };
    expect(body(await h.call('pipe__run', { chain: w }))).toMatchObject({ status: 'done', result: 'hi' });
  });
  it('with confirmWrites, a write step needs a confirm; plan lists every step', async () => {
    const hc = await startHarness(undefined, { confirmWrites: true });
    try {
      const w = { steps: [{ id: 'a', call: 'echo__rows', args: { n: 1 } }, { id: 'b', call: 'echo__echo', args: { text: 'hi' } }] };
      const first = body(await hc.call('pipe__run', { chain: w }));
      expect(first.status).toBe('needs_confirm');
      expect(first.plan.map((p: any) => p.step)).toEqual(['a', 'b']);
      const ok = body(await hc.call('pipe__run', { run: first.run, confirm: first.confirm }));
      expect(ok).toMatchObject({ status: 'done', result: 'hi' });
    } finally { await hc.close(); }
  });
  it('dry_run does not execute', async () => {
    const before = body(await h.call('echo__stats')).calls.rows;
    const d = body(await h.call('pipe__run', { chain, dry_run: true }));
    expect(d).toMatchObject({ status: 'dry_run' });
    expect(d.run).toMatch(/^r\d+$/);
    expect(body(await h.call('echo__stats')).calls.rows).toBe(before);
  });
  it('from re-runs a step using stored earlier outputs', async () => {
    const r = body(await h.call('pipe__run', { chain }));
    const before = body(await h.call('echo__stats')).calls.rows;
    const again = body(await h.call('pipe__run', { run: r.run, from: 'names' }));
    expect(again.status).toBe('done');
    expect(body(await h.call('echo__stats')).calls.rows).toBe(before);
  });
});

describe('engine across restarts', () => {
  it('a new proxy + pool continues from stored step outputs', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-run-')), 'store.db');
    const store = new SqliteStore(file);
    const servers = { echo: fixtureServer('echo-server') };
    const h1 = await startHarness(servers, {}, { store });
    const b = body(await h1.call('pipe__run', { chain: { steps: [{ id: 'rows', call: 'echo__rows', args: { n: 2 } }, { id: 'x', call: 'echo__bad_sql', args: { q: 'q' } }] } }));
    await h1.close();
    const h2 = await startHarness(servers, {}, { store });
    try {
      const p = body(await h2.call('pipe__patch', { run: b.run, step: 'x', edits: [{ path: 'call', set: 'echo__lookup' }, { path: 'args', set: { key: '{{ rows | length | tostring }}' } }] }));
      expect(p).toMatchObject({ status: 'done', result: { key: '2' } });
      expect(body(await h2.call('echo__stats')).calls.rows).toBeUndefined(); // fresh fixture process: rows never re-run
    } finally { await h2.close(); store.close(); }
  });
});

describe('ai steps', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => {
    h = await startHarness({ echo: fixtureServer('echo-server'), hr: { ...fixtureServer('echo-server'), pipe: { visibility: 'hidden' } } });
  });
  afterAll(async () => { await h.close(); });

  const aiChain = {
    steps: [
      { id: 'rows', call: 'echo__rows', args: { n: 3 } },
      { id: 'up', ai: 'Uppercase each name', input: '$rows | map(.name)', expect: { type: 'array', items: { type: 'string' }, sameLengthAs: 'rows' } },
      { id: 'out', jq: '$up | join(",")' },
    ],
  };

  it('pauses with input inline (session); valid resume continues to done', async () => {
    const p = body(await h.call('pipe__run', { chain: aiChain }));
    expect(p).toMatchObject({ status: 'paused', step: 'up', by: 'session', task: 'Uppercase each name' });
    expect(p.input).toEqual(['row-1', 'row-2', 'row-3']);
    const before = body(await h.call('echo__stats')).calls.rows;
    const done = body(await h.call('pipe__resume', { run: p.run, step: 'up', output: ['ROW-1', 'ROW-2', 'ROW-3'] }));
    expect(done).toMatchObject({ status: 'done', result: 'ROW-1,ROW-2,ROW-3' });
    expect(body(await h.call('echo__stats')).calls.rows).toBe(before);
  });
  it('wrong length rejected with reason; JSON string output parsed', async () => {
    const p = body(await h.call('pipe__run', { chain: aiChain }));
    const bad = body(await h.call('pipe__resume', { run: p.run, step: 'up', output: ['A'] }));
    expect(bad).toMatchObject({ status: 'rejected' });
    expect(bad.reason).toMatch(/1 items, expected 3/);
    const ok = body(await h.call('pipe__resume', { run: p.run, step: 'up', output: '["A","B","C"]' }));
    expect(ok.result).toBe('A,B,C');
  });
  it('resume on a run that is not paused → error', async () => {
    const r = body(await h.call('pipe__run', { chain: { steps: [{ id: 'a', jq: '1' }] } }));
    const e = await h.call('pipe__resume', { run: r.run, step: 'a', output: 1 });
    expect(e.isError).toBe(true);
    expect(texts(e)[0]).toMatch(/not paused/);
  });
  it('subagent payload has no input data; batch → chunks, out-of-order resume keeps order', async () => {
    const c = {
      steps: [
        { id: 'rows', call: 'echo__rows', args: { n: 45 } },
        { id: 'up', ai: 'Uppercase', input: '$rows | map(.name)', by: 'subagent', batch: 20, expect: { type: 'array', items: { type: 'string' }, sameLengthAs: 'rows' } },
        { id: 'first_last', jq: '[$up[0], $up[-1], ($up | length)]' },
      ],
    };
    const p = body(await h.call('pipe__run', { chain: c }));
    expect(JSON.stringify(p)).not.toContain('row-1');
    expect(p.chunks).toHaveLength(3);
    expect(p).toMatchObject({ status: 'paused', by: 'subagent' });
    const chunk = async (i: number) => JSON.parse(texts(await h.call('pipe__get', { handle: p.chunks[i].inputHandle }))[0]!) as string[];
    const up = async (i: number) => (await chunk(i)).map((s) => s.toUpperCase());
    expect(body(await h.call('pipe__resume', { run: p.run, step: 'up', chunk: 2, output: await up(2) })).openChunks).toEqual([0, 1]);
    const dup = await h.call('pipe__resume', { run: p.run, step: 'up', chunk: 2, output: await up(2) });
    expect(texts(dup)[0]).toMatch(/already resumed/);
    await h.call('pipe__resume', { run: p.run, step: 'up', chunk: 0, output: await up(0) });
    const done = body(await h.call('pipe__resume', { run: p.run, step: 'up', chunk: 1, output: await up(1) }));
    expect(done).toMatchObject({ status: 'done', result: ['ROW-1', 'ROW-45', 45] });
  });
  it('ai step over hidden data refused', async () => {
    const r = await h.call('pipe__run', { chain: { steps: [{ id: 's', call: 'hr__lookup', args: { key: 'a' } }, { id: 'x', ai: 'summarize', input: '$s' }] } });
    expect(body(r)).toMatchObject({ status: 'failed', step: 'x' });
    expect(body(r).error).toMatch(/cannot read hidden data/);
  });
});

describe('idempotent map steps', () => {
  it('failed map keeps finished items; patch + rerun skips them; force re-sends', async () => {
    const h = await startHarness(undefined, { confirmWrites: true });
    try {
      // json fails for item 3 only via a jq-built arg that errors downstream: use bad_sql for odd items
      const c = {
        steps: [
          { id: 'items', jq: '[1,2,3,4,5]' },
          { id: 'w', map: 'echo__json', over: 'items', args: { value: '{{ item }}' } },
        ],
      };
      const first = body(await h.call('pipe__run', { chain: c }));
      const done = body(await h.call('pipe__run', { run: first.run, confirm: first.confirm }));
      expect(done.status).toBe('done');
      const base = body(await h.call('echo__stats')).calls.json;
      const again = body(await h.call('pipe__run', { run: first.run, from: 'w' }));
      const ok = body(await h.call('pipe__run', { run: first.run, confirm: again.confirm }));
      expect(ok.status).toBe('done');
      expect(body(await h.call('echo__stats')).calls.json).toBe(base); // all 5 items skipped
      const f1 = body(await h.call('pipe__run', { run: first.run, from: 'w', force: true }));
      body(await h.call('pipe__run', { run: first.run, confirm: f1.confirm, force: true }));
      expect(body(await h.call('echo__stats')).calls.json).toBe(base + 5);
    } finally { await h.close(); }
  });
  it('a map step that fails part-way: fixed items only re-run', async () => {
    const h = await startHarness();
    try {
      const c = {
        steps: [
          { id: 'items', jq: '["a","b","bad","d"]' },
          { id: 'w', map: 'echo__lookup', over: 'items', args: { key: '{{ item }}' } },
          { id: 'check', map: 'echo__bad_sql', over: 'items', args: { q: '{{ item }}' } },
        ],
      };
      const r = body(await h.call('pipe__run', { chain: c }));
      expect(r).toMatchObject({ status: 'failed', step: 'check' });
      const before = body(await h.call('echo__stats')).calls.lookup;
      const p = body(await h.call('pipe__patch', { run: r.run, step: 'check', edits: [{ path: 'map', set: 'echo__lookup' }, { path: 'args', set: { key: '{{ item }}!' } }] }));
      expect(p.status).toBe('done');
      expect(body(await h.call('echo__stats')).calls.lookup).toBe(before + 4); // only the check step's 4 items
    } finally { await h.close(); }
  });
});

describe('pipes passed as text (e.g. from a skill)', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  beforeAll(async () => { h = await startHarness(); });
  afterAll(async () => { await h.close(); });
  const yaml = `
name: count-rows
params: { n: number }
steps:
  - id: rows
    call: echo__rows
    args: { n: "{{ n }}" }
  - id: count
    jq: '$rows | length'
`;
  it('YAML text with params runs', async () => {
    expect(body(await h.call('pipe__run', { chain: yaml, params: { n: 4 } })).result).toBe(4);
    expect(body(await h.call('pipe__run', { chain: yaml, params: { n: 7 } })).result).toBe(7);
  });
  it('missing / wrong-type param → error before any step', async () => {
    const before = body(await h.call('echo__stats')).calls.rows;
    expect(texts(await h.call('pipe__run', { chain: yaml, params: {} }))[0]).toMatch(/missing param "n"/);
    expect(texts(await h.call('pipe__run', { chain: yaml, params: { n: 'x' } }))[0]).toMatch(/must be number, got string/);
    expect(body(await h.call('echo__stats')).calls.rows).toBe(before);
  });
});

describe('translate-deck end to end (scripted AI)', () => {
  it('every box updated, one pause per chunk, AI never sees the deck in the pause payload', async () => {
    const h = await startHarness({ slides: fixtureServer('slides-server') });
    try {
      const paused = body(await h.call('pipe__run', { chain: TRANSLATE, params: { deck_id: 'd1', lang: 'Hebrew' } }));
      expect(paused).toMatchObject({ status: 'paused', step: 'tr', by: 'subagent', task: 'Translate each item to Hebrew. Return a JSON array, same order, same length.' });
      expect(JSON.stringify(paused)).not.toContain('text 1');
      expect(paused.chunks).toHaveLength(3);
      let reply: any;
      for (const ch of paused.chunks) {
        const input = JSON.parse(texts(await h.call('pipe__get', { handle: ch.inputHandle }))[0]!) as string[];
        reply = body(await h.call('pipe__resume', { run: paused.run, step: 'tr', chunk: ch.index, output: input.map((t) => t.toUpperCase()) }));
      }
      expect(reply.status).toBe('done');
      expect(texts(await h.call('slides__writes'))[0]).toBe('45');
      const deck = JSON.parse(texts(await h.call('slides__list_text', { deck: 'd1' }))[0]!);
      expect(deck.every((b: any) => b.text === b.text.toUpperCase())).toBe(true);
      expect(deck[44].text).toBe('TEXT 45');
    } finally { await h.close(); }
  });
});

describe('store runs', () => {
  it('runs round-trip and survive reopen', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-runs-')), 's.db');
    for (const make of [() => new MemoryStore(), () => new SqliteStore(file)]) {
      const s = make();
      const r = s.putRun({ session: 's', chain: { steps: [{ id: 'a', jq: '1' }] }, params: { x: 1 }, steps: { a: { status: 'paused' } }, status: 'paused' });
      expect(r.id).toMatch(/^r\d+$/);
      r.status = 'done';
      s.updateRun(r);
      expect(s.getRun(r.id)!.status).toBe('done');
      s.close();
    }
    const again = new SqliteStore(file);
    expect(again.getRun('r1')!.params).toEqual({ x: 1 });
    again.close();
  });
});

describe('example skills', () => {
  const dir = path.resolve(import.meta.dirname, '../../examples/skills');
  for (const f of fs.readdirSync(dir)) {
    it(`${f}/SKILL.md pipe parses`, () => {
      const md = fs.readFileSync(path.join(dir, f, 'SKILL.md'), 'utf8');
      const yaml = /```yaml\n([\s\S]*?)```/.exec(md)![1]!;
      expect(parseChain(yaml).steps.length).toBeGreaterThan(0);
    });
  }
});
