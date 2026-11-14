# Plans (chains)

A chain is a plan the AI writes once and mcp-pipe runs step by step — one request instead of a call per step, and the data between steps never passes through the conversation.

```json
{
  "chain": {
    "params": { "sheet": "string" },
    "steps": [
      { "id": "rows",  "call": "db__query", "args": { "sql": "SELECT country, SUM(total) AS revenue FROM orders GROUP BY 1" } },
      { "id": "table", "jq": "($rows[0] | keys_unsorted) as $k | [$k] + ($rows | map([.[$k[]]]))" },
      { "id": "write", "call": "sheets__append_rows", "args": { "sheet": "{{ sheet }}", "values": "{{ table }}" } }
    ]
  },
  "params": { "sheet": "Revenue" }
}
```

## Step kinds

| step | does |
|---|---|
| `{id, call: "<tool>", args}` | calls a tool |
| `{id, jq: "<program>"}` | computes a value; params and earlier step outputs are jq variables (`$rows`) |
| `{id, map: "<tool>", over, args, concurrency?}` | calls a tool once per item (`{{ item }}`) |
| `{id, ai: "<task>", input?, by?, batch?, expect?}` | pauses for a step that needs judgement — see [AI steps](./ai-steps) |

In `args` and `ai` text, `{{ name }}` refers to a param, an earlier step, or any handle. A chain can be given as an object or as YAML/JSON text.

Checked before anything runs: step ids are unique; each step has exactly one kind; refs only point to params and **earlier** steps (the error names the step); declared params are present with the right type.

## Running

- `pipe__run {chain, params}` — define and run.
- `pipe__run {run: "r1"}` — run (or continue) an existing run.
- `pipe__run {run, from: "<step>"}` — run again from a step; earlier outputs are reused.
- `dry_run: true` — validate and store the run, return the plan, run nothing.

Reply when done:

```json
{ "status": "done", "run": "r4", "outputs": { "rows": "c12.out", "table": "c13.out", "write": "c14.out" }, "result": "…last step's value…" }
```

Large or [hidden](./blind-mode) results show a shape instead of the value.

## When a step fails

The run stops (`status: failed`, with the step and error). Fix the step and continue:

```json
{ "run": "r4", "step": "rows", "edits": [{ "path": "args.sql", "find": "usr_id", "replace": "user_id" }] }
```

`pipe__patch` with `run` + `step` edits the step definition (any field: `args`, `jq`, `over`, `call`, …), re-checks the chain, and re-runs from that step. Earlier steps are not repeated — also after mcp-pipe restarts, because runs and outputs are stored.

## Confirm (optional)

Steps run without asking by default. With `confirmWrites: true` in the config, a plan with a tool that can change data first returns the plan and a confirm token (see [Map](./map#optional-confirm-for-tools-that-can-change-data)). One confirm covers the run, including after AI pauses, until the chain is patched.

## Map steps are idempotent

A `map` step records each finished item. Re-running the step (after a patch, or with `from`) skips items that already succeeded; `force: true` sends them all again.
