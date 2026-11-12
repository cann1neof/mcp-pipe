import { shapeOf } from './values.js';

export type PathSeg = string | number;
export type Handle = { call: string; side: 'in' | 'out'; path: PathSeg[] };

/** Parses a path like `.rows[0].name`, `rows[0]["a b"]` or `sql`. */
export function parsePath(s: string): PathSeg[] {
  const out: PathSeg[] = [];
  let i = 0;
  const src = s.trim();
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '.') { i++; continue; }
    if (ch === '[') {
      const close = src.indexOf(']', i);
      if (close < 0) throw new Error(`bad path "${s}": missing ]`);
      const inner = src.slice(i + 1, close).trim();
      if (/^-?\d+$/.test(inner)) out.push(Number(inner));
      else if (/^(["']).*\1$/.test(inner)) out.push(inner.slice(1, -1));
      else throw new Error(`bad path "${s}": [${inner}] must be a number or quoted key`);
      i = close + 1;
      continue;
    }
    const m = /^[^.[\]]+/.exec(src.slice(i));
    if (!m) throw new Error(`bad path "${s}" at position ${i}`);
    out.push(m[0]);
    i += m[0].length;
  }
  return out;
}

/** Parses `c3.out.rows[0].name`. Accepts `$c3…`, `{{ c3… }}`, and bare `c3` (= `c3.out`). */
export function parseHandle(raw: string): Handle {
  let s = raw.trim();
  const braces = /^\{\{\s*([\s\S]*?)\s*\}\}$/.exec(s);
  if (braces) s = braces[1]!;
  if (s.startsWith('$')) s = s.slice(1);
  const m = /^(c\d+)(?:\.(in|out)\b)?(.*)$/.exec(s);
  if (!m) throw new Error(`bad handle "${raw}": expected like c3.out or c3.in.sql`);
  return { call: m[1]!, side: (m[2] as 'in' | 'out' | undefined) ?? 'out', path: parsePath(m[3] ?? '') };
}

export function formatPath(path: PathSeg[]): string {
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : /^[A-Za-z_][\w-]*$/.test(p) ? `.${p}` : `["${p}"]`)).join('');
}

/** Walks `path` into `v`. On failure the error names the failing step and what is available there. */
export function resolvePath(v: unknown, path: PathSeg[]): unknown {
  let cur = v;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i]!;
    const at = formatPath(path.slice(0, i)) || '(root)';
    if (Array.isArray(cur)) {
      if (typeof seg !== 'number') throw new Error(`path ${formatPath(path)}: ${at} is ${shapeOf(cur)}, use an index like [0]`);
      const idx = seg < 0 ? cur.length + seg : seg;
      if (idx < 0 || idx >= cur.length) throw new Error(`path ${formatPath(path)}: index ${seg} out of range at ${at} (length ${cur.length})`);
      cur = cur[idx];
    } else if (cur !== null && typeof cur === 'object') {
      const key = String(seg);
      if (!Object.prototype.hasOwnProperty.call(cur, key)) {
        const keys = Object.keys(cur as object);
        throw new Error(`path ${formatPath(path)}: no key "${key}" at ${at}; available: ${keys.slice(0, 30).join(', ') || '(none)'}`);
      }
      cur = (cur as Record<string, unknown>)[key];
    } else {
      throw new Error(`path ${formatPath(path)}: ${at} is ${shapeOf(cur)}, cannot go into it`);
    }
  }
  return cur;
}

/** Returns a copy of `v` with the value at `path` replaced. Creates missing object keys at the last step. */
export function setPath(v: unknown, path: PathSeg[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(v)) {
    if (typeof head !== 'number') throw new Error(`cannot set key "${head}" on an array`);
    const idx = head < 0 ? v.length + head : head;
    if (idx < 0 || idx >= v.length) throw new Error(`index ${head} out of range (length ${v.length})`);
    const copy = [...v];
    copy[idx] = setPath(v[idx], rest, value);
    return copy;
  }
  if (v !== null && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const key = String(head);
    if (rest.length > 0 && !(key in obj)) throw new Error(`no key "${key}"; available: ${Object.keys(obj).join(', ')}`);
    return { ...obj, [key]: setPath(obj[key], rest, value) };
  }
  throw new Error(`cannot set inside ${shapeOf(v)}`);
}
