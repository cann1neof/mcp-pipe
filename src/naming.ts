export const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX = 64;

const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_') || '_';

/** Namespaced tool name `<server>__<tool>`, sanitized, ≤64 chars and unique within `taken` (adds it). */
export function toolName(server: string, tool: string, taken: Set<string>): string {
  const base = `${clean(server)}__${clean(tool)}`.slice(0, MAX);
  let name = base;
  for (let i = 2; taken.has(name); i++) {
    const suffix = `_${i}`;
    name = base.slice(0, MAX - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}
