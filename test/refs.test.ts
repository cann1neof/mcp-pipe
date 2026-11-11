import { describe, it, expect } from 'vitest';
import { parseHandle, parsePath, resolvePath, setPath } from '../src/refs.js';

describe('parseHandle', () => {
  it('parses call, side, path', () => {
    expect(parseHandle('c3.out.rows[0].name')).toEqual({ call: 'c3', side: 'out', path: ['rows', 0, 'name'] });
  });
  it('accepts $ and {{ }} and bare id', () => {
    expect(parseHandle('$c1.in.sql')).toEqual({ call: 'c1', side: 'in', path: ['sql'] });
    expect(parseHandle('{{ c2.out }}')).toEqual({ call: 'c2', side: 'out', path: [] });
    expect(parseHandle('c7')).toEqual({ call: 'c7', side: 'out', path: [] });
  });
  it('rejects garbage', () => expect(() => parseHandle('foo')).toThrow(/bad handle/));
});

describe('paths', () => {
  it('parses quoted keys and negatives', () => expect(parsePath('a["b c"][-1]')).toEqual(['a', 'b c', -1]));
  it('resolves', () => expect(resolvePath({ rows: [{ name: 'x' }] }, ['rows', 0, 'name'])).toBe('x'));
  it('bad key lists available keys', () => {
    expect(() => resolvePath({ rows: [{ name: 'x', id: 1 }] }, ['rows', 0, 'nme'])).toThrow(/available: name, id/);
  });
  it('setPath copies', () => {
    const a = { x: { y: 1 } };
    expect(setPath(a, ['x', 'y'], 2)).toEqual({ x: { y: 2 } });
    expect(a.x.y).toBe(1);
  });
});
