import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { transform } from '../../src/jq.js';
import { substituteRefs, parseRefExpr, type Resolver } from '../../src/refs.js';
import { widenSchema } from '../../src/schema.js';
import { shapeOf, preview } from '../../src/values.js';
import { maskError, policyFor } from '../../src/policy.js';
import { ConfirmTokens, gate, isWrite } from '../../src/security.js';
import { expandSecrets, parseConfig } from '../../src/config.js';

const values: Record<string, unknown> = {
  'c1.out': { hash: 'a1b2c3d4', rows: [{ id: 1 }, { id: 2 }], n: 3 },
  'c2.out': ['x', 'y'],
};
const resolve: Resolver = (name) => {
  if (name in values) return { value: values[name] };
  throw new Error(`unknown handle ${name}`);
};

describe('jq transforms', () => {
  it('sql rows → sheet rows with header', async () => {
    const out = await transform([{ name: 'Ann', total: 120 }, { name: 'Bo', total: 80 }], '(.[0]|keys_unsorted) as $k | [$k] + map([.[$k[]]])');
    expect(out).toEqual([['name', 'total'], ['Ann', 120], ['Bo', 80]]);
  });
  it('text → one row per line', async () => {
    expect(await transform('a\n\nb\n', 'split("\\n") | map(select(. != "") | [.])')).toEqual([['a'], ['b']]);
  });
  it('gsub', async () => expect(await transform('<a class="x">', 'gsub("class="; "className=")')).toBe('<a className="x">'));
  it('vars', async () => expect(await transform(null, '$boxes | length', { boxes: [1, 2] })).toBe(2));
  it('several outputs → array; none → null', async () => {
    expect(await transform([1, 2], '.[]')).toEqual([1, 2]);
    expect(await transform([1, 2], 'empty')).toBeNull();
  });
  it('error message from jq', async () => {
    await expect(transform({ a: 1 }, '.a | .b')).rejects.toThrow(/Cannot index number/);
  });
  it('runaway filter times out, next call works', async () => {
    await expect(transform(null, 'repeat(1)', {}, 1000)).rejects.toThrow(/timed out/);
    expect(await transform(2, '. * 3')).toBe(6);
  }, 10_000);
});

describe('ref substitution', () => {
  it('whole-string ref keeps type', async () => {
    expect((await substituteRefs({ v: '{{ c1.out.rows }}' }, resolve)).value).toEqual({ v: [{ id: 1 }, { id: 2 }] });
  });
  it('nested object/array refs', async () => {
    const r = await substituteRefs({ a: [{ b: '{{c2.out[1]}}' }] }, resolve);
    expect(r.value).toEqual({ a: [{ b: 'y' }] });
  });
  it('embedded ref with jq slicing → text', async () => {
    const r = await substituteRefs({ q: "id LIKE '{{ c1.out.hash | .[0:4] }}%'" }, resolve);
    expect(r.value).toEqual({ q: "id LIKE 'a1b2%'" });
  });
  it('embedded object → JSON text', async () => {
    expect((await substituteRefs('rows: {{ c1.out.rows }}', resolve)).value).toBe('rows: [{"id":1},{"id":2}]');
  });
  it('whole-string with jq keeps type', async () => {
    expect((await substituteRefs('{{ c1.out.rows | length }}', resolve)).value).toBe(2);
  });
  it('escape \\{{ gives literal braces', async () => {
    expect((await substituteRefs('Hello \\{{ name }}!', resolve)).value).toBe('Hello {{ name }}!');
  });
  it('unknown handle → error mentioning escape', async () => {
    await expect(substituteRefs('Hi {{ name }}', resolve)).rejects.toThrow(/unknown handle name.*literal braces/s);
  });
  it('two refs in one string', async () => {
    expect((await substituteRefs('{{c2.out[0]}}-{{c2.out[1]}}', resolve)).value).toBe('x-y');
  });
  it('taint is collected', async () => {
    const r = await substituteRefs('{{ s.x }}', (n) => ({ value: { x: 1 }, hiddenFrom: n === 's' ? ['hr'] : [] }));
    expect(r.hiddenFrom).toEqual(['hr']);
  });
  it('parseRefExpr splits jq at top-level pipe only', () => {
    expect(parseRefExpr('c3.out["a|b"] | .x | length')).toEqual({ name: 'c3.out', path: ['a|b'], jq: '.x | length' });
    expect(parseRefExpr('item.name')).toEqual({ name: 'item', path: ['name'] });
  });
});

describe('schema widening', () => {
  const s = { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } }, q: { type: 'string' } }, required: ['values'] };
  const ajv = new Ajv({ strict: false });
  const v = ajv.compile(widenSchema(s));
  it('array property accepts ref string', () => expect(v({ values: '{{ c1.out | map(.id) }}' })).toBe(true));
  it('original values still validate', () => expect(v({ values: [1, 2] })).toBe(true));
  it('non-ref string still rejected for array', () => expect(v({ values: 'nope' })).toBe(false));
  it('plain string props unchanged; required unchanged', () => {
    const w = widenSchema(s) as any;
    expect(w.properties.q).toEqual({ type: 'string' });
    expect(w.required).toEqual(['values']);
  });
  it('schema without properties unchanged', () => expect(widenSchema({ type: 'object' })).toEqual({ type: 'object' }));
});

describe('values', () => {
  it('shapeOf full and types', () => {
    const v = [{ user_id: 1, name: 'a' }, { user_id: 2, name: 'b' }];
    expect(shapeOf(v)).toBe('array[2] of {user_id:number,name:string(1)}');
    expect(shapeOf(v, 'types')).toBe('array of {user_id:number,name:string}');
  });
  it('preview shows shape and first 5', () => {
    const p = preview(Array.from({ length: 100 }, (_, i) => i));
    expect(p).toMatch(/array\[100\]/);
    expect(p).toMatch(/first 5: \[0,1,2,3,4\]/);
  });
});

describe('policy', () => {
  const cfg = parseConfig({ mcpServers: { hr: { command: 'x', pipe: { visibility: 'hidden', shape: 'types', allowSinks: ['sheets'], tools: { list_tables: { visibility: 'visible' } } } }, other: { command: 'y' } } });
  it('server and tool level', () => {
    expect(policyFor(cfg, 'hr', 'query')).toEqual({ visibility: 'hidden', shape: 'types', errors: 'class', allowSinks: ['sheets'] });
    expect(policyFor(cfg, 'hr', 'list_tables').visibility).toBe('visible');
    expect(policyFor(cfg, 'other', 'x')).toEqual({ visibility: 'visible', shape: 'full', errors: 'full' });
  });
  it('rejects unknown policy keys', () => {
    expect(() => parseConfig({ mcpServers: { a: { command: 'x', pipe: { visiblity: 'hidden' } } } })).toThrow(/a/);
  });
  it('maskError keeps kind, drops values', () => {
    expect(maskError(`syntax error near 'salary = 123456' in "SELECT 1"\nmore`)).toBe(`syntax error near '***' in "***"`);
    expect(maskError('no such column: usr_id at line 3')).toBe('no such column: usr_id at line #');
  });
});

describe('security', () => {
  it('isWrite unless readOnlyHint', () => {
    expect(isWrite({ name: 'a', inputSchema: { type: 'object' } })).toBe(true);
    expect(isWrite({ name: 'a', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } })).toBe(false);
  });
  it('confirm tokens: one-time, plan-bound, expiring', () => {
    const t = new ConfirmTokens();
    const plan = [{ tool: 'x', count: 2, writes: true }];
    const needs = gate(t, plan, undefined)!;
    expect(needs.status).toBe('needs_confirm');
    expect(gate(t, plan, needs.confirm)).toBeUndefined();
    expect(() => gate(t, plan, needs.confirm)).toThrow(/already used/);
    const tok2 = t.issue(plan);
    expect(() => t.consume(tok2, [{ tool: 'x', count: 3, writes: true }])).toThrow(/plan changed/);
    const tok3 = t.issue(plan, 0);
    expect(() => t.consume(tok3, plan, 11 * 60_000)).toThrow(/expired/);
    expect(gate(t, [{ tool: 'r', count: 9, writes: false }], undefined)).toBeUndefined();
  });
});

describe('secrets', () => {
  it('env and keychain refs', () => {
    const v = expandSecrets({ a: '${env:T}', b: 'Bearer ${keychain:svc/acct}' }, { env: { T: '1' }, keychain: (s, a) => `${s}:${a}` });
    expect(v).toEqual({ a: '1', b: 'Bearer svc:acct' });
  });
  it('missing env → error naming server and var', () => {
    expect(() => parseConfig({ mcpServers: { pg: { command: 'x', env: { P: '${env:NOPE_Z}' } } } }, 'cfg', { env: {} })).toThrow(/server "pg".*NOPE_Z/);
  });
  it('missing keychain item → error', () => {
    expect(() => expandSecrets('${keychain:a/b}', { keychain: () => { throw new Error('keychain item not found'); } })).toThrow(/not found/);
  });
});
