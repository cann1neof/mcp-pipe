import { parsePath, resolvePath, setPath, formatPath, type PathSeg } from '../refs.js';
import { text, type Op } from './context.js';

export type Edit = { find: string; replace: string; path?: string } | { path: string; set: unknown };

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

/** Applies edits to a copy of `target`. Throws (naming the edit) if a find has no match. */
export function applyEdits(target: unknown, edits: Edit[]): unknown {
  let cur = structuredClone(target);
  edits.forEach((e, i) => {
    const where = `edit ${i + 1}`;
    if (e === null || typeof e !== 'object') throw new Error(`${where}: must be an object`);
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
    const sub = resolvePath(cur, path);
    const [next, count] = replaceAll(sub, e.find, e.replace);
    if (count === 0) {
      throw new Error(`${where}: no match for ${JSON.stringify(e.find)}${path.length ? ` in ${formatPath(path)}` : ''}`);
    }
    cur = setPath(cur, path, next);
  });
  return cur;
}

export function editsOf(args: Record<string, unknown>): Edit[] {
  const edits = args.edits ?? [];
  if (!Array.isArray(edits)) throw new Error('"edits" must be an array');
  return edits as Edit[];
}

/** Patch of a single stored call (the chain form, with "run" + "step", is added by the run ops). */
export async function patchCall(args: Record<string, unknown>, core: import('../core.js').PipeCore) {
  const id = String(args.call ?? '').trim().replace(/^\$/, '').replace(/\.(in|out)$/, '');
  const orig = core.store.getCall(id);
  if (!orig) throw new Error(`unknown handle ${id}`);
  if (orig.server === 'pipe') throw new Error(`${id} is an mcp-pipe operation, not a tool call; patch the run step instead`);
  const newArgs = applyEdits(orig.args, editsOf(args));
  if (args.run === false) {
    const rec = core.store.putCall({ session: core.session, server: orig.server, tool: orig.tool, args: newArgs, parent: orig.id });
    return text(`created ${rec.id} (patched from ${orig.id}, not run). Run it with pipe__patch {"call":"${rec.id}"}, or read it with pipe__get {"handle":"${rec.id}.in"}.`);
  }
  const rec = await core.invoke({ server: orig.server, tool: orig.tool, args: newArgs, parent: orig.id });
  return core.respond(rec);
}

export const PATCH_DESCRIPTION =
  'Re-run an earlier tool call with modified arguments. The call\'s stored arguments are copied, ' +
  'the edits are applied to the copy, and the result is executed as a new call with its own handle. ' +
  'Edit forms: {find, replace} replaces text in string arguments (all of them, or only under "path"); ' +
  '{path, set} sets the value at "path". With no edits the call is re-run unchanged.';

export const patchOp: Op = {
  def: {
    name: 'pipe__patch',
    description: PATCH_DESCRIPTION,
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
  handle: patchCall,
};
