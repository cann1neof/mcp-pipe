# pipe__* tools

Downstream tools appear as `<server>__<tool>` with their own schema (non-string arguments also accept a `{{ … }}` ref string; `outputSchema` is not advertised). Every result ends with a handle block `⟨pipe:cN⟩`.

## pipe__get

Read a stored value. Read-only.

| arg | type | |
|---|---|---|
| `handle` | string | `c3.out`, `c3.in.sql`, `c3.out[0].id`, or `status` |
| `jq` | string? | filter applied to the value |

Errors: unknown handle; path not found (lists the keys available there); value hidden by policy.

## pipe__patch

Re-run a stored call with edits, or fix a step of a run.

| arg | type | |
|---|---|---|
| `call` | string | handle of the call (`c3`) |
| `edits` | array? | `{find, replace, path?}` or `{path, set}` |
| `run` | boolean? (with `call`) | `false` stores the new call without running |
| `run` + `step` | string, string | patch a chain step instead; continues the run from it |
| `rerun` | boolean? | with `run` + `step`: `false` only patches |
| `confirm` | string? | token, when the patched run has write steps |

Errors: no match for a `find` (nothing runs); unknown handle / run / step; patched chain invalid.

## pipe__transform

Apply jq to a stored value and store the output. Read-only.

| arg | type | |
|---|---|---|
| `from` | string | handle with optional path |
| `jq` | string | filter |

## pipe__map

Call a tool once per item of a stored list.

| arg | type | |
|---|---|---|
| `tool` | string | `server__tool` |
| `over` | string | handle of a list (optionally `{{ … \| jq }}`) |
| `args` | object | per-call arguments; `{{ item }}`, `{{ item.path }}` |
| `concurrency` | number? | default 4, max 32 |
| `dry_run` | boolean? | plan only |
| `confirm` | string? | token from `needs_confirm` |

Returns `{ok, failed: [{index, error}], handles, outputs}` or `{status: "needs_confirm", plan, confirm}`.

## pipe__run

Run a plan: exactly one of `chain`, `run`, `recipe`.

| arg | type | |
|---|---|---|
| `chain` | object / string | new chain (see [Plans](../guide/chains)) |
| `run` | string | existing run id |
| `recipe` | string | saved recipe name |
| `params` | object? | chain params |
| `from` | string? | step to run again from |
| `dry_run` | boolean? | plan only |
| `confirm` | string? | token |
| `force` | boolean? | repeat map items that already succeeded |

Returns one of `done` (`outputs`, `result`), `failed` (`step`, `error`, `next`), `paused` (see [AI steps](../guide/ai-steps)), `needs_confirm`, `dry_run`.

## pipe__define

Validate a chain and store it as a run without executing. Returns `{run, steps, plan}`. Read-only.

## pipe__resume

| arg | type | |
|---|---|---|
| `run` | string | |
| `step` | string | the paused `ai` step |
| `chunk` | number? | required when the step has several chunks |
| `output` | any | checked against the step's `expect` |

Returns `rejected` (with `reason`; run stays paused), `paused` (other chunks open), or the run's next reply.

## pipe__save

| arg | type | |
|---|---|---|
| `run` | string | run whose chain to save |
| `name` | string | letters, digits, `-`, `_` |
| `description` | string? | |
| `overwrite` | boolean? | |

## pipe__recipes

Lists `{name, description, params}` of saved recipes (and parse errors, if any). Read-only.
