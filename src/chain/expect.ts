// Validation of `ai` step outputs: a JSON Schema plus `sameLengthAs: <step id>`.
import { Ajv } from 'ajv';

const ajv = new Ajv({ strict: false, allErrors: false });

/** AI output that is JSON text is parsed once ("[\"a\"]" → ["a"]). Other strings stay strings. */
export function normalizeOutput(output: unknown): unknown {
  if (typeof output !== 'string') return output;
  const t = output.trim();
  if (!/^[[{"]|^-?\d|^(true|false|null)$/.test(t)) return output;
  try { return JSON.parse(t); } catch { return output; }
}

/** Returns a reason string if `output` does not satisfy `expect`, else undefined. */
export function checkExpect(output: unknown, expect: Record<string, unknown> | undefined, expectedLength?: number): string | undefined {
  if (!expect) return undefined;
  const { sameLengthAs: _s, ...schema } = expect;
  if (Object.keys(schema).length) {
    const validate = ajv.compile(schema);
    if (!validate(output)) {
      const e = validate.errors?.[0];
      return `output does not match expect: ${e ? `${e.instancePath || '(root)'} ${e.message}` : 'invalid'}`;
    }
  }
  if (expectedLength !== undefined) {
    if (!Array.isArray(output)) return `output must be an array of length ${expectedLength}`;
    if (output.length !== expectedLength) return `output has ${output.length} items, expected ${expectedLength}`;
  }
  return undefined;
}
