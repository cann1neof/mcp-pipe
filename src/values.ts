import type { CallToolResult } from './types.js';

/** The "value" of a tool result: structuredContent ?? JSON of a single text block ?? text ?? content. */
export function resultValue(r: CallToolResult): unknown {
  if (r.structuredContent !== undefined) return r.structuredContent;
  const content = r.content ?? [];
  const texts = content.filter((c) => c.type === 'text') as { type: 'text'; text: string }[];
  if (texts.length === content.length && texts.length > 0) {
    const text = texts.map((t) => t.text).join('\n');
    if (texts.length === 1) {
      try { return JSON.parse(text); } catch { /* not JSON */ }
    }
    return text;
  }
  return content;
}

export type ShapeMode = 'full' | 'types';

/**
 * Type signature of a value, e.g. `array[120] of {user_id:number,name:string}`.
 * mode "types" leaves out lengths and counts.
 */
export function shapeOf(v: unknown, mode: ShapeMode = 'full', depth = 0): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    const n = mode === 'full' ? `[${v.length}]` : '';
    if (v.length === 0) return `array${n}`;
    return `array${n} of ${depth >= 2 ? '…' : shapeOf(v[0], mode, depth + 1)}`;
  }
  if (typeof v === 'object') {
    if (depth >= 2) return 'object';
    const keys = Object.keys(v as object);
    const shown = keys.slice(0, 12).map((k) => `${k}:${shapeOf((v as Record<string, unknown>)[k], mode, depth + 1)}`);
    if (keys.length > 12) shown.push(mode === 'full' ? `…+${keys.length - 12}` : '…');
    return `{${shown.join(',')}}`;
  }
  if (typeof v === 'string') return mode === 'full' ? `string(${v.length})` : 'string';
  return typeof v;
}

/** Shape + a small sample of a value, for results too big to return whole. */
export function preview(v: unknown, items = 5, chars = 1000): string {
  const shape = `shape: ${shapeOf(v)}`;
  if (Array.isArray(v)) return `${shape}\nfirst ${Math.min(items, v.length)}: ${clip(JSON.stringify(v.slice(0, items)), chars * 2)}`;
  if (typeof v === 'string') return `${shape}\nstart: ${v.slice(0, chars)}`;
  return `${shape}\nstart: ${clip(JSON.stringify(v), chars)}`;
}

/** Bytes of text content in a result (images/binary are not counted). */
export function textBytes(r: CallToolResult): number {
  let n = 0;
  for (const c of r.content ?? []) if (c.type === 'text') n += Buffer.byteLength(c.text);
  if (r.structuredContent !== undefined) n = Math.max(n, Buffer.byteLength(JSON.stringify(r.structuredContent)));
  return n;
}

export function hasBinary(r: CallToolResult): boolean {
  return (r.content ?? []).some((c) => c.type !== 'text');
}

export function errorText(r: CallToolResult): string {
  return (r.content ?? []).flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
