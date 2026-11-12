import { parsePath, resolvePath, setPath, formatPath, type PathSeg } from '../refs.js';
import { text, type Op } from './context.js';

type Edit = { find: string; replace: string; path?: string } | { path: string; set: unknown };

/** Replaces every occurrence of `find` in all string leaves of `v`. Returns [newValue, count]. */
function replaceAll(v: unknown, find: string, replace: string): [unknown, number] {
  if (typeof v === 'string') {
    const parts = v.split(find);
    return [parts.join(replace), parts.length - 1];
  }
  if (Array.isArray(v)) {
    let n = 0;
    const out = v.map((x) => { const [y, c] = replaceAll(x, find, replace); n += c; return y; });
    return [out, n];
  }
  if (v !== null && typeof v === 'object') {
    let n = 0;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const [y, c] = replaceAll(x, find, replace); out[k] = y; n += c; }
    return [out, n];
  }
  return [v, 0];
}

export function applyEdits(args: unknown, edits: Edit[]): unknown {
  let cur = structuredClone(args);
  edits.forEach((e, i) => {
    const where = `edit ${i + 1}`;
    if ('set' in e) {
      if (typeof e.path !== 'string') throw new Error(`${where}: "set" needs "path"`);
      cur = setPath(cur, parsePath(e.path), e.set);
      return;
    }
    if (typeof e.find !== 'string' || typeof e.replace !== 'string') {
      throw new Error(`${where}: needs {find, replace} or {path, set}`);
    }
    if (e.find === '') throw new Error(`${where}: "find" must not be empty`);
    const path: PathSeg[] = e.path ? parsePath(e.path) : [];
    const target = resolvePath(cur, path);
    const [next, count] = replaceAll(target, e.find, e.replace);
    if (count === 0) {
      throw new Error(`${where}: no match for ${JSON.stringify(e.find)}${path.length ? ` in ${formatPath(path)}` : ''}`);
    }
    cur = setPath(cur, path, next);
  });
  return cur;
}

export const patchOp: Op = {
  def: {
    name: 'pipe__patch',
    description:
      'Re-run an earlier tool call with modified arguments. The call\'s stored arguments are copied, ' +
      'the edits are applied to the copy, and the result is executed as a new call with its own handle. ' +
      'Edit forms: {find, replace} replaces text in string arguments (all of them, or only under "path"); ' +
      '{path, set} sets the value at "path". With no edits the call is re-run unchanged.',
    inputSchema: {
      type: 'object',
      properties: {
        call: { type: 'string', description: 'handle of the call, e.g. "c3"' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
              path: { type: 'string', description: 'path inside the arguments, e.g. "a.b[0]"' },
              set: { description: 'new value for "path"' },
            },
          },
        },
        run: { type: 'boolean', description: 'execute the new call (default true); false only stores it' },
      },
      required: ['call'],
    },
  },
  async handle(args, { store, session, execute }) {
    const id = String(args.call ?? '').replace(/^\$/, '').replace(/\.in$|\.out$/, '');
    const orig = store.getCall(id);
    if (!orig) throw new Error(`unknown handle ${id}`);
    const edits = args.edits ?? [];
    if (!Array.isArray(edits)) throw new Error('"edits" must be an array');
    const newArgs = applyEdits(orig.args, edits as Edit[]);
    const rec = store.putCall({ session, server: orig.server, tool: orig.tool, args: newArgs, parent: orig.id });
    if (args.run === false) {
      return text(`created ${rec.id} (patched from ${orig.id}, not run). Run it with pipe__patch {call:"${rec.id}"} (no edits = rerun as-is), or inspect with pipe__get {handle:"${rec.id}.in"}.`);
    }
    return execute(rec);
  },
};
