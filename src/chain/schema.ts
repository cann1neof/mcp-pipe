// Chains (and saved recipes): an ordered list of steps. YAML or JSON is only the container;
// data work inside steps is jq, and arguments use {{ name[.path] [| jq] }} refs.
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PARAM_TYPES = ['string', 'number', 'boolean', 'array', 'object'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

const expectSchema = z.record(z.string(), z.unknown());

const base = { id: z.string().regex(ID, 'step id must be a letter/underscore followed by letters, digits or underscores') };
const callStep = z.object({ ...base, call: z.string().min(1), args: z.record(z.string(), z.unknown()).optional() }).strict();
const jqStep = z.object({ ...base, jq: z.string().min(1) }).strict();
const mapStep = z.object({
  ...base, map: z.string().min(1), over: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional(), concurrency: z.number().int().min(1).max(32).optional(),
}).strict();
const aiStep = z.object({
  ...base, ai: z.string().min(1), input: z.string().optional(),
  by: z.enum(['session', 'subagent']).optional(), batch: z.number().int().min(1).optional(), expect: expectSchema.optional(),
}).strict();

export type CallStep = z.infer<typeof callStep>;
export type JqStep = z.infer<typeof jqStep>;
export type MapStep = z.infer<typeof mapStep>;
export type AiStep = z.infer<typeof aiStep>;
export type Step = CallStep | JqStep | MapStep | AiStep;
export type StepKind = 'call' | 'jq' | 'map' | 'ai';

const chainSchema = z.object({
  recipe: z.string().optional(),
  description: z.string().optional(),
  params: z.record(z.string().regex(ID), z.enum(PARAM_TYPES)).optional(),
  steps: z.array(z.record(z.string(), z.unknown())).min(1),
}).strict();

export type Chain = {
  recipe?: string;
  description?: string;
  params?: Record<string, ParamType>;
  steps: Step[];
};

const KINDS: StepKind[] = ['call', 'jq', 'map', 'ai'];
const SCHEMAS = { call: callStep, jq: jqStep, map: mapStep, ai: aiStep };

export function stepKind(s: Step): StepKind {
  return KINDS.find((k) => k in s)!;
}

function zodMsg(e: z.ZodError, where: string): string {
  const i = e.issues[0]!;
  return `${where}: ${i.path.length ? `"${i.path.join('.')}" ` : ''}${i.message}`;
}

/** Root names used by {{ … }} refs in any string of `v`. */
export function refNames(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'string') {
    for (const m of v.matchAll(/(^|[^\\])\{\{\s*\$?([A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(m[2]!);
  } else if (Array.isArray(v)) v.forEach((x) => refNames(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => refNames(x, out));
  return out;
}

/** `$name` variables used in a jq program (jq built-ins like $ENV and $__loc__ are ignored). */
export function jqVars(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) if (m[1] !== 'ENV' && !m[1]!.startsWith('__')) out.add(m[1]!);
  // variables bound inside the program (`as $x`) are local, not references
  for (const m of src.matchAll(/\bas\s+\$([A-Za-z_][A-Za-z0-9_]*)/g)) out.delete(m[1]!);
  return out;
}

const isHandle = (n: string) => /^c\d+$/.test(n);

/** Parses and validates a chain (YAML/JSON text or an object). Errors name the step. */
export function parseChain(src: string | object): Chain {
  let raw: unknown = src;
  if (typeof src === 'string') {
    try { raw = parseYaml(src); } catch (e) { throw new Error(`chain is not valid YAML/JSON: ${(e as Error).message}`); }
  }
  const top = chainSchema.safeParse(raw);
  if (!top.success) throw new Error(zodMsg(top.error, 'chain'));
  const params = top.data.params ?? {};
  const seen = new Set<string>();
  const steps: Step[] = [];

  top.data.steps.forEach((rawStep, i) => {
    const label = `step ${i + 1}${typeof rawStep.id === 'string' ? ` "${rawStep.id}"` : ''}`;
    const kinds = KINDS.filter((k) => k in rawStep);
    if (kinds.length !== 1) {
      throw new Error(`${label}: needs exactly one of ${KINDS.join(', ')}${kinds.length ? ` (has ${kinds.join(' and ')})` : ''}`);
    }
    const r = SCHEMAS[kinds[0]!].safeParse(rawStep);
    if (!r.success) throw new Error(zodMsg(r.error, label));
    const step = r.data as Step;
    if (seen.has(step.id)) throw new Error(`${label}: duplicate step id "${step.id}"`);
    if (step.id in params) throw new Error(`${label}: step id "${step.id}" is also a param name`);
    if (step.id === 'item') throw new Error(`${label}: "item" is reserved for map items`);

    const known = (n: string, allowItem: boolean) => isHandle(n) || n in params || seen.has(n) || (allowItem && n === 'item');
    const check = (names: Set<string>, allowItem: boolean, what: string) => {
      for (const n of names) {
        if (known(n, allowItem)) continue;
        const later = top.data.steps.slice(i + 1).some((s) => s.id === n);
        throw new Error(`${label}: ${what} refers to ${later ? `later step "${n}"` : `unknown name "${n}"`}; ` +
          `use params (${Object.keys(params).join(', ') || 'none'}) or earlier steps (${[...seen].join(', ') || 'none'})`);
      }
    };
    switch (stepKind(step)) {
      case 'call': check(refNames((step as CallStep).args ?? {}), false, 'args'); break;
      case 'jq': check(jqVars((step as JqStep).jq), false, 'jq'); break;
      case 'map': {
        const m = step as MapStep;
        const overName = /^\s*(?:\{\{\s*)?\$?([A-Za-z_][A-Za-z0-9_-]*)/.exec(m.over)?.[1] ?? m.over;
        check(new Set([overName.replace(/\.(in|out)$/, '')]), false, 'over');
        check(refNames(m.args ?? {}), true, 'args');
        break;
      }
      case 'ai': {
        const a = step as AiStep;
        check(refNames(a.ai), false, 'ai text');
        if (a.input) check(jqVars(a.input), false, 'input');
        if (typeof a.expect?.sameLengthAs === 'string') check(new Set([a.expect.sameLengthAs]), false, 'expect.sameLengthAs');
        break;
      }
    }
    seen.add(step.id);
    steps.push(step);
  });

  return {
    ...(top.data.recipe ? { recipe: top.data.recipe } : {}),
    ...(top.data.description ? { description: top.data.description } : {}),
    ...(top.data.params ? { params: top.data.params } : {}),
    steps,
  };
}
