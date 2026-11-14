import type { PipeCore } from '../core.js';
import { Engine } from '../chain/engine.js';
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
  '{jq: "<program>"} computes a value, with params, earlier step outputs and saved calls as jq variables ($id, $c7); ' +
  '{map: "<tool>", over: "<step id or handle of a list>", args: {...}} calls a tool once per item ("{{ item }}", "{{ item.path }}"); ' +
  '{ai: "<task>", input?: "<jq program>", by?: "session"|"subagent", batch?: n, expect?: <JSON Schema>} pauses the run for ' +
  'a step that needs judgement (done by you or a subagent), continued with pipe__resume. ' +
  'In args, "{{ name[.path] [| jq] }}" refers to a param, an earlier step\'s output, or any handle.';

const chainProps = {
  chain: { description: 'chain object (or YAML/JSON text)' },
  params: { type: 'object', description: 'values for the chain\'s params' },
};

export const runOp: Op = {
  def: {
    name: 'pipe__run',
    description:
      'Run a multi-step plan in one request: pass a new "chain" (JSON or YAML text, e.g. copied from a skill) with its "params", ' +
      'or an existing "run" id to run it again. ' +
      'Steps run back to back in one request; every step\'s output is saved and can be referred to by later steps. ' +
      `${CHAIN_FORMAT} ` +
      'The reply lists each step\'s output handle and the last step\'s result. A failing step stops the run; ' +
      'pipe__patch {run, step, edits} edits that step and re-runs from it without repeating earlier ones. ' +
      '"from" re-runs from a step; "dry_run" returns the plan; "force" repeats map items that already succeeded.',
    inputSchema: {
      type: 'object',
      properties: {
        ...chainProps,
        run: { type: 'string', description: 'existing run id, e.g. "r1"' },
        from: { type: 'string', description: 'step id to run again from' },
        dry_run: { type: 'boolean', description: 'validate and return the plan without running it' },
        confirm: { type: 'string', description: 'only if a reply asked for it: the token from that needs_confirm reply' },
        force: { type: 'boolean' },
      },
    },
  },
  async handle(args, core) {
    const e = engineFor(core);
    const params = (args.params ?? {}) as Record<string, unknown>;
    const given = ['chain', 'run'].filter((k) => args[k] !== undefined);
    if (given.length !== 1) throw new Error('pass exactly one of "chain" or "run"');
    const id = args.chain !== undefined ? e.define(args.chain as object, params).id : String(args.run);
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
