import type { Tool } from '@modelcontextprotocol/sdk/types.js';

type JSONSchema = Record<string, unknown>;

export const REF_SCHEMA: JSONSchema = {
  type: 'string',
  pattern: '^\\s*\\{\\{[\\s\\S]*\\}\\}\\s*$',
  description: 'reference to a stored value: {{ <handle>[.path] [| jq] }}',
};

export const REF_HINT = 'Any argument may also be a reference "{{ <handle>[.path] [| jq] }}" to a stored value.';

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
