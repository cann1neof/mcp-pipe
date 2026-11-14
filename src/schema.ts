import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type JSONSchema = Record<string, unknown>;

export const REF_SCHEMA: JSONSchema = {
  type: 'string',
  pattern: '^\\s*\\{\\{[\\s\\S]*\\}\\}\\s*$',
  description: 'a saved result instead of a literal value, e.g. "{{ c3.out }}", "{{ c3.out.rows }}" or "{{ c3.out | map(.id) }}"',
};

export const REF_HINT =
  'Every result ends with "saved as {{ cN.out }}". Any argument can take a saved result instead of a literal: ' +
  '"{{ c3.out }}", a part "{{ c3.out.rows[0].id }}", or any jq expression over saved results ' +
  '"{{ [["name","total"]] + (c3.out | map([.name, .total])) }}". ' +
  'The value is filled in before the call, so data from one tool goes to the next without being copied.';

const isPlainString = (p: unknown) =>
  !!p && typeof p === 'object' && (p as JSONSchema).type === 'string' && !('enum' in (p as JSONSchema)) && !('pattern' in (p as JSONSchema));

/**
 * Widens a tool's input schema so every top-level property also accepts a `{{ … }}` reference string.
 * Plain string properties already accept refs and stay as they are; `required` is unchanged.
 */
export function widenSchema(s: JSONSchema): JSONSchema {
  const props = s.properties as Record<string, unknown> | undefined;
  if (!props || typeof props !== 'object') return s;
  const widened: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(props)) {
    widened[k] = isPlainString(p) ? p : { anyOf: [p, REF_SCHEMA] };
  }
  return { ...s, properties: widened };
}

/** The downstream tool as the host sees it: renamed, schema widened, output schema dropped. */
export function exposeTool(def: Tool, name: string): Tool {
  // outputSchema is dropped: blind and peek responses replace structured content, and hosts
  // validate structuredContent against an advertised outputSchema.
  const { outputSchema: _drop, ...rest } = def;
  const description = [def.description, REF_HINT].filter(Boolean).join('\n\n');
  return { ...rest, name, description, inputSchema: widenSchema(def.inputSchema as JSONSchema) as Tool['inputSchema'] };
}

const JSON_TYPES = new Set(['array', 'object', 'number', 'integer', 'boolean', 'null']);

/** JSON types a property schema accepts, or undefined when the schema does not say. */
function acceptedTypes(p: unknown): Set<string> | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const s = p as JSONSchema;
  if (typeof s.type === 'string') return new Set([s.type]);
  if (Array.isArray(s.type)) return new Set(s.type as string[]);
  const alts = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (!Array.isArray(alts)) return undefined;
  const out = new Set<string>();
  for (const a of alts) {
    const t = acceptedTypes(a);
    if (!t) return undefined;
    t.forEach((x) => out.add(x));
  }
  return out;
}

const typeOf = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v;

/**
 * Hosts sometimes send an array or object argument as JSON text (`"[[1,2]]"`), which the widened schema allows
 * because it also accepts ref strings. For top-level properties whose original schema does not accept a string,
 * a string that is not a ref and parses as JSON of an accepted type is replaced by the parsed value.
 */
export function coerceJsonStrings(args: unknown, schema: JSONSchema | undefined): unknown {
  const props = schema?.properties as Record<string, unknown> | undefined;
  if (!props || !args || typeof args !== 'object' || Array.isArray(args)) return args;
  let out: Record<string, unknown> | undefined;
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v !== 'string' || v.includes('{{')) continue;
    const types = acceptedTypes(props[k]);
    if (!types || types.has('string') || ![...types].some((t) => JSON_TYPES.has(t))) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(v); } catch { continue; }
    const t = typeOf(parsed);
    if (!types.has(t) && !(t === 'integer' && types.has('number'))) continue;
    (out ??= { ...(args as Record<string, unknown>) })[k] = parsed;
  }
  return out ?? args;
}
