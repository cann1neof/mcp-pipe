import { describe, it, expect } from 'vitest';
import { toolName, NAME_RE } from '../src/naming.js';

describe('toolName', () => {
  it('namespaces', () => expect(toolName('pg', 'query', new Set())).toBe('pg__query'));
  it('sanitizes dots and spaces', () => {
    const n = toolName('my.server', 'a b', new Set());
    expect(n).toMatch(NAME_RE);
    expect(n).toBe('my_server__a_b');
  });
  it('truncates long names and dedupes collisions', () => {
    const taken = new Set<string>();
    const long = 'x'.repeat(70);
    const a = toolName(long, 'one', taken);
    const b = toolName(long, 'two', taken);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(b).toMatch(NAME_RE);
    expect(a).not.toBe(b);
    expect(b.endsWith('_2')).toBe(true);
  });
});
