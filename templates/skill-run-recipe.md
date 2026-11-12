---
name: run-recipe
description: Run a saved mcp-pipe recipe by name, e.g. "run recipe translate-deck with deck_id=abc lang=Hebrew". Use when the user asks to run, repeat or reuse a saved workflow.
---

# Run an mcp-pipe recipe

1. If the recipe name or its params are unclear, call `pipe__recipes` and pick the matching one.
2. Call `pipe__run` with `{"recipe": "<name>", "params": {…}}`. Pass params with their declared types.
3. Handle the reply by `status`:
   - `needs_confirm` — show the user the `plan` (tools and steps that change data). Only if they agree, repeat the call with `"run": "<run id>"` and `"confirm": "<token>"`.
   - `paused` — an `ai` step needs you. Follow `next` exactly:
     - `by: session`: do `task` on `input`, then `pipe__resume`.
     - `by: subagent`: start one subagent per open chunk; each reads its input with `pipe__get` on `inputHandle`, does the task, and calls `pipe__resume` itself. Do not read the input yourself.
   - `failed` — read `error`; fix the step with `pipe__patch {"run", "step", "edits"}` (it continues from that step), or report the error.
   - `done` — report `result` to the user. Large or hidden results show only a shape; fetch with `pipe__get` only if the user needs the data.
4. Never re-type data that a step already produced; refer to it by handle instead.
