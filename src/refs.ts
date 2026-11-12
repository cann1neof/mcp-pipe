import { shapeOf } from './values.js';
import { transform } from './jq.js';

export type PathSeg = string | number;
export type Handle = { call: string; side: 'in' | 'out'; path: PathSeg[] };

/** What a ref name resolves to. `hiddenFrom` lists the servers whose hidden data the value carries. */
export type RefTarget = { value: unknown; hiddenFrom?: string[] };
/** Resolves a ref root name: a handle ("c3.out", "c3.in"), or in chains a param / step id / "item". */
export type Resolver = (name: string) => RefTarget;

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
  const m = /^(c\d+)(?![\w-])(?:\.(in|out)(?![\w-]))?(.*)$/.exec(s);
  if (!m) throw new Error(`bad handle "${raw}": expected like c3.out or c3.in.sql`);
  return { call: m[1]!, side: (m[2] as 'in' | 'out' | undefined) ?? 'out', path: parsePath(m[3] ?? '') };
}

export type RefExpr = { name: string; path: PathSeg[]; jq?: string };

/** Splits `name.path | jq` at the first top-level `|` (outside quotes and brackets). */
function splitJq(s: string): [string, string | undefined] {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === '|' && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return [s, undefined];
}

/** Parses the inside of `{{ … }}`: a root name, an optional path, an optional `| jq` filter. */
export function parseRefExpr(inner: string): RefExpr {
  const [refPart, jqPart] = splitJq(inner.trim());
  let s = refPart.trim();
  if (s.startsWith('$')) s = s.slice(1);
  let name: string;
  let rest: string;
  const h = /^(c\d+)(?![\w-])(?:\.(in|out)(?![\w-]))?/.exec(s);
  if (h) {
    name = `${h[1]}.${h[2] ?? 'out'}`;
    rest = s.slice(h[0].length);
  } else {
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(s);
    if (!id) throw new Error(`bad reference "{{${inner}}}": expected a handle like c3.out or a name`);
    name = id[0];
    rest = s.slice(id[0].length);
  }
  const jq = jqPart?.trim();
  return { name, path: parsePath(rest), ...(jq ? { jq } : {}) };
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

// ---------------------------------------------------------------------------
// Substituting {{ … }} refs inside arguments

const TEMPLATE = /(\\?)\{\{((?:(?!\{\{|\}\})[\s\S])*)\}\}/g;
const WHOLE = /^\s*\{\{((?:(?!\{\{|\}\})[\s\S])*)\}\}\s*$/;

export type Resolved = { value: unknown; hiddenFrom: string[]; wholeRefs: { expr: string; value: unknown }[] };

/** True if any string inside `v` contains an unescaped `{{`. */
export function hasRefs(v: unknown): boolean {
  if (typeof v === 'string') return /(^|[^\\])\{\{/.test(v);
  if (Array.isArray(v)) return v.some(hasRefs);
  if (v !== null && typeof v === 'object') return Object.values(v).some(hasRefs);
  return false;
}

/** Resolves one ref expression (`c3.out.rows | length`) to a value. */
export async function evalRef(inner: string, resolve: Resolver): Promise<RefTarget> {
  const expr = parseRefExpr(inner);
  const target = resolve(expr.name);
  let value = resolvePath(target.value, expr.path);
  if (expr.jq) value = await transform(value, expr.jq);
  return { value, ...(target.hiddenFrom?.length ? { hiddenFrom: target.hiddenFrom } : {}) };
}

/** Resolves an expression given with or without braces: `c3.out.rows`, `{{ c3.out | length }}`. */
export async function evalExpr(expr: string, resolve: Resolver): Promise<RefTarget> {
  const whole = WHOLE.exec(expr);
  return evalRef(whole ? whole[1]! : expr, resolve);
}

/**
 * Deep-walks `args` and replaces every `{{ name[.path] [| jq] }}`.
 * A string that is exactly one ref becomes the referenced value (any type); refs inside longer text
 * are inserted as text (strings as-is, other values as JSON). `\{{` yields a literal `{{`.
 */
export async function substituteRefs(args: unknown, resolve: Resolver): Promise<Resolved> {
  const hidden = new Set<string>();
  const wholeRefs: Resolved['wholeRefs'] = [];

  const one = async (inner: string): Promise<unknown> => {
    let t: RefTarget;
    try {
      t = await evalRef(inner, resolve);
    } catch (e) {
      throw new Error(`${(e as Error).message} in "{{${inner}}}" (to send literal braces, write \\{{)`);
    }
    t.hiddenFrom?.forEach((s) => hidden.add(s));
    return t.value;
  };

  const walk = async (v: unknown): Promise<unknown> => {
    if (typeof v === 'string') {
      if (!v.includes('{{')) return v;
      const whole = WHOLE.exec(v);
      if (whole && !v.trimStart().startsWith('\\')) {
        const value = await one(whole[1]!);
        wholeRefs.push({ expr: whole[1]!.trim(), value });
        return value;
      }
      let out = '';
      let last = 0;
      for (const m of v.matchAll(TEMPLATE)) {
        out += v.slice(last, m.index);
        if (m[1]) out += `{{${m[2]}}}`; // escaped
        else {
          const val = await one(m[2]!);
          out += typeof val === 'string' ? val : JSON.stringify(val);
        }
        last = m.index! + m[0].length;
      }
      return out + v.slice(last);
    }
    if (Array.isArray(v)) {
      const res: unknown[] = [];
      for (const x of v) res.push(await walk(x));
      return res;
    }
    if (v !== null && typeof v === 'object') {
      const res: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) res[k] = await walk(x);
      return res;
    }
    return v;
  };

  const value = await walk(args);
  return { value, hiddenFrom: [...hidden], wholeRefs };
}
