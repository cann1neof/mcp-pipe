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

/** Short human description of a value's type, used in error messages. */
export function shapeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as object);
    return `object{${keys.slice(0, 10).join(', ')}${keys.length > 10 ? ', …' : ''}}`;
  }
  if (typeof v === 'string') return `string(${v.length})`;
  return typeof v;
}
