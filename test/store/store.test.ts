import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../../src/store/memory.js';
import { SqliteStore } from '../../src/store/sqlite.js';
import type { Store } from '../../src/store/store.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-')), 'store.db');
const base = { session: 's1', server: 'echo', tool: 'echo', args: { text: 'hi' } };
const opened: Store[] = [];
afterEach(() => { opened.splice(0).forEach((s) => s.close()); });

const impls: [string, () => Store][] = [
  ['memory', () => new MemoryStore()],
  ['sqlite', () => new SqliteStore(tmp())],
];

describe.each(impls)('%s store', (_name, make) => {
  const mk = () => { const s = make(); opened.push(s); return s; };
  it('ids increment c1, c2', () => {
    const s = mk();
    expect(s.putCall(base).id).toBe('c1');
    expect(s.putCall(base).id).toBe('c2');
  });
  it('finishCall persists result', () => {
    const s = mk();
    const { id } = s.putCall(base);
    s.finishCall(id, { content: [{ type: 'text', text: 'hi' }] }, false);
    const rec = s.getCall(id)!;
    expect(rec.result!.content[0]).toEqual({ type: 'text', text: 'hi' });
    expect(rec.isError).toBe(false);
    expect(rec.args).toEqual({ text: 'hi' });
  });
  it('getCall unknown → undefined', () => {
    expect(mk().getCall('c99')).toBeUndefined();
    expect(mk().getCall('nope')).toBeUndefined();
  });
  it('200 concurrent putCall → 200 unique ids', async () => {
    const s = mk();
    const ids = await Promise.all(Array.from({ length: 200 }, async () => s.putCall(base).id));
    expect(new Set(ids).size).toBe(200);
  });
  it('stores parent', () => {
    const s = mk();
    const a = s.putCall(base);
    const b = s.putCall({ ...base, parent: a.id });
    expect(s.getCall(b.id)!.parent).toBe(a.id);
  });
});

describe('sqlite only', () => {
  it('db file mode is 0600', () => {
    const p = tmp();
    const s = new SqliteStore(p);
    s.putCall(base);
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    s.close();
  });
  it('persists across reopen', () => {
    const p = tmp();
    const a = new SqliteStore(p);
    const { id } = a.putCall(base);
    a.close();
    const b = new SqliteStore(p);
    expect(b.getCall(id)!.tool).toBe('echo');
    expect(b.putCall(base).id).toBe('c2');
    b.close();
  });
});
