import type { PipeCore } from '../core.js';
import { Engine } from '../chain/engine.js';
import { listRecipes, loadRecipe, recipesDir, saveRecipe } from '../recipes.js';
import { json, type Op } from './context.js';
import { editsOf, patchCall, PATCH_DESCRIPTION } from './patch.js';

const engines = new WeakMap<PipeCore, Engine>();
export const engineFor = (core: PipeCore) => {
  let e = engines.get(core);
  if (!e) engines.set(core, (e = new Engine(core)));
  return e;
};

const CHAIN_FORMAT =
  'A chain is {params?: {name: type}, steps: [...]}; each step has an "id" and one of: ' +
  '{call: "<tool>", args: {...}} calls a tool; ' +
  '{jq: "<program>"} computes a value, with params and earlier step outputs as jq variables ($id); ' +
  '{map: "<tool>", over: "<step id or handle of a list>", args: {...}} calls a tool once per item ("{{ item }}", "{{ item.path }}"); ' +
  '{ai: "<task>", input?: "<jq program>", by?: "session"|"subagent", batch?: n, expect?: <JSON Schema>} pauses the run for ' +
  'a step that needs judgement (done by you or a subagent), continued with pipe__resume. ' +
  'In args, "{{ name[.path] [| jq] }}" refers to a param, an earlier step\'s output, or any handle.';

const chainProps = {
  chain: { description: 'chain object (or YAML/JSON text)' },
  params: { type: 'object', description: 'values for the chain\'s params' },
};

export const defineOp: Op = {
  def: {
    name: 'pipe__define',
    description: `Validate a chain and store it as a run without executing it. Returns the run id and its plan. ${CHAIN_FORMAT}`,
    inputSchema: { type: 'object', properties: chainProps, required: ['chain'] },
    annotations: { readOnlyHint: true },
  },
  async handle(args, core) {
    const e = engineFor(core);
    const r = e.define(args.chain as object, (args.params ?? {}) as Record<string, unknown>);
    return json({ run: r.id, steps: r.chain.steps.map((s) => s.id), plan: e.plan(r) });
  },
};

export const runOp: Op = {
  def: {
    name: 'pipe__run',
    description:
      'Run a multi-step plan in one request: pass a new "chain", an existing "run" id, or a saved "recipe" name with "params". ' +
      `${CHAIN_FORMAT} ` +
      'The reply lists each step\'s output handle and the last step\'s result. A failing step stops the run; fix it with ' +
      'pipe__patch {run, step, edits}, which re-runs from that step without repeating earlier ones. Plans with tools that can ' +
      'change data need a confirm: the first reply is the plan and a token, then repeat the call with "confirm". ' +
      '"from" re-runs from a step; "dry_run" returns the plan; "force" repeats map items that already succeeded.',
    inputSchema: {
      type: 'object',
      properties: {
        ...chainProps,
        run: { type: 'string', description: 'existing run id, e.g. "r1"' },
        recipe: { type: 'string', description: 'saved recipe name' },
        from: { type: 'string', description: 'step id to run again from' },
        dry_run: { type: 'boolean' },
        confirm: { type: 'string', description: 'token from a needs_confirm reply' },
        force: { type: 'boolean' },
      },
    },
  },
  async handle(args, core) {
    const e = engineFor(core);
    const params = (args.params ?? {}) as Record<string, unknown>;
    const given = ['chain', 'run', 'recipe'].filter((k) => args[k] !== undefined);
    if (given.length !== 1) throw new Error('pass exactly one of "chain", "run" or "recipe"');
    let id: string;
    if (args.chain !== undefined) id = e.define(args.chain as object, params).id;
    else if (args.recipe !== undefined) id = e.define(loadRecipe(recipesDir(core.cfg.recipesDir), String(args.recipe)), params).id;
    else id = String(args.run);
    const reply = await e.run(id, {
      ...(typeof args.from === 'string' ? { from: args.from } : {}),
      ...(typeof args.confirm === 'string' ? { confirm: args.confirm } : {}),
      dryRun: args.dry_run === true,
      force: args.force === true,
    });
    return json(reply, undefined, reply.status === 'failed');
  },
};

export const resumeOp: Op = {
  def: {
    name: 'pipe__resume',
    description:
      'Give the result of a paused ai step and continue its run. "output" is checked against the step\'s "expect"; ' +
      'if it does not match, the reply says why and the run stays paused. For a batched step, resume each chunk by its index.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string' },
        step: { type: 'string' },
        chunk: { type: 'number', description: 'chunk index, for batched steps' },
        output: { description: 'the step result (any JSON value)' },
      },
      required: ['run', 'step', 'output'],
    },
  },
  async handle(args, core) {
    const reply = await engineFor(core).resume(String(args.run), String(args.step),
      typeof args.chunk === 'number' ? args.chunk : undefined, args.output);
    return json(reply, undefined, reply.status === 'failed');
  },
};

export const saveOp: Op = {
  def: {
    name: 'pipe__save',
    description: 'Save the chain of a run as a reusable recipe. Run it later with pipe__run {recipe, params}.',
    inputSchema: {
      type: 'object',
      properties: {
        run: { type: 'string' },
        name: { type: 'string', description: 'letters, digits, "-" or "_"' },
        description: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      required: ['run', 'name'],
    },
  },
  async handle(args, core) {
    const r = engineFor(core).getRun(String(args.run));
    const file = saveRecipe(recipesDir(core.cfg.recipesDir), String(args.name), r.chain, {
      ...(typeof args.description === 'string' ? { description: args.description } : {}),
      overwrite: args.overwrite === true,
    });
    return json({ saved: String(args.name), file, params: r.chain.params ?? {} });
  },
};

export const recipesOp: Op = {
  def: {
    name: 'pipe__recipes',
    description: 'List saved recipes with their descriptions and params.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  async handle(_args, core) {
    return json(listRecipes(recipesDir(core.cfg.recipesDir)));
  },
};

/** pipe__patch, extended: {call} patches a stored call; {run, step} patches a chain step and re-runs from it. */
export const patchAnyOp: Op = {
  def: {
    name: 'pipe__patch',
    description: `${PATCH_DESCRIPTION} To fix a step of a run instead, pass "run" (run id) and "step": the edits apply to the ` +
      'step definition (e.g. path "args.sql", or find/replace in its text) and the run continues from that step; earlier steps are not repeated.',
    inputSchema: {
      type: 'object',
      properties: {
        call: { type: 'string', description: 'handle of the call, e.g. "c3"' },
        run: { description: 'run id (with "step"); or, with "call", false to only store the new call', anyOf: [{ type: 'string' }, { type: 'boolean' }] },
        step: { type: 'string', description: 'step id inside the run' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
              path: { type: 'string', description: 'path inside the arguments / step, e.g. "a.b[0]"' },
              set: { description: 'new value for "path"' },
            },
          },
        },
        rerun: { type: 'boolean', description: 'with run+step: continue the run after patching (default true)' },
        confirm: { type: 'string', description: 'token from a needs_confirm reply' },
      },
    },
  },
  async handle(args, core) {
    if (typeof args.run === 'string') {
      if (typeof args.step !== 'string') throw new Error('"step" is required with "run"');
      const e = engineFor(core);
      const r = e.patchStep(args.run, args.step, editsOf(args));
      if (args.rerun === false) return json({ status: 'patched', run: r.id, step: args.step, plan: e.plan(r, args.step) });
      const reply = await e.run(r.id, { from: args.step, ...(typeof args.confirm === 'string' ? { confirm: args.confirm } : {}) });
      return json(reply, undefined, reply.status === 'failed');
    }
    if (args.call === undefined) throw new Error('pass "call" (a call handle) or "run" + "step"');
    return patchCall(args, core);
  },
};
