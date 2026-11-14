---
name: mcp-pipe
description: How to work with tools served through mcp-pipe (tools named <server>__<tool> plus pipe__run, pipe__patch, pipe__transform, pipe__map, pipe__get, pipe__resume). Use for any task that calls these tools, especially when data from one tool goes into another, a list needs one call per item, or a call has to be fixed and repeated.
---

# Working with mcp-pipe

mcp-pipe sits between you and the MCP servers. It saves every call: its arguments and its result. Each result ends with its reference, for example `saved as {{ c7.out }}`. Work with these references instead of with the data itself.

## Rules

1. **Never copy data from a result into another call.** Pass the reference instead. mcp-pipe fills in the value before the call:
   - the whole result: `"{{ c7.out }}"`
   - a part: `"{{ c7.out.rows[0].id }}"`
   - reshaped with jq: `"{{ c7.out | map([.name, .total]) }}"`
   - any jq expression over saved results: `"{{ [["Name", "Total"]] + (c7.out | map([.name, .total])) }}"`

   A string that is exactly one reference becomes the value with its own type (array, object, number). A reference inside longer text is inserted as text.
2. **Compute in the tools, not in your head.** Percentages, totals, rounding, formatting and joins belong in the query (SQL) or in jq over a saved result. Write the formula, not the numbers.
3. **Fix a call by patching it, not by rewriting it.** `pipe__patch {"call": "c3", "edits": [{"find": "usr_id", "replace": "user_id"}]}` copies the saved arguments, applies the change and runs the call again. Edits are `{find, replace}` (text in string arguments) or `{path, set}` (any value).
4. **Read only what you need.** Large results come back as a preview. Use `pipe__get {"handle": "c7.out.rows", "jq": ".[0:5]"}` or a path like `c7.out.rows[0].id` for the part you need, not the whole value.
5. **`pipe__transform` must transform its input.** It applies jq to a saved value and saves the result under a new reference. A filter that ignores its input is refused; pass literal values directly in the tool argument instead.

## Workflow

1. **Look first, with single calls.** Read schemas and descriptions, take small samples (`LIMIT 3`), check date ranges and IDs. Don't trust metadata blindly: if a call fails on a name from the docs, check the real one, then patch.
2. **Then write the rest as one pipe** and run it with `pipe__run`. Do this as soon as you know the remaining steps, especially when one step's output feeds the next. The steps run back to back without a round trip through you, and no intermediate data enters the conversation.
3. **If a step fails, patch that step.** `pipe__patch {"run": "r1", "step": "cohorts", "edits": [...]}` edits the step and continues the run from it. Earlier steps are not repeated. Don't write a new pipe.
4. **Report from the outputs.** The reply lists each step's reference and the last step's result. Use `pipe__get` on a step output if you need to show part of it.

Single calls are fine for one-off lookups. Use a pipe once there are two or more dependent steps.

## Pipe format

`pipe__run {"chain": <YAML or JSON>, "params": {...}}`:

```yaml
params: { sql: string, channel: string }
steps:
  - id: rows                      # a tool call
    call: db__run_query
    args: { sql: "{{ sql }}" }
  - id: table                     # jq: params and earlier steps are $variables
    jq: '[["Country", "Revenue"]] + ($rows | map([.country, .revenue]))'
  - id: sheet
    call: sheets__create_spreadsheet
    args: { title: "Revenue" }
  - id: write                     # earlier steps as references in arguments
    call: sheets__update_values
    args: { spreadsheet_id: "{{ sheet.spreadsheet_id }}", start_cell: "A1", values: "{{ table }}" }
  - id: notify                    # one call per item of a list
    map: chat__post_message
    over: rows
    args: { channel: "{{ channel }}", text: "{{ item.country }}: {{ item.revenue }}" }
```

- In `args`, `{{ name }}` refers to a param, an earlier step id, or any saved call (`c7.out`), and `{{ <jq expression> }}` can combine them: `{{ "Sheet: " + sheet.url }}`. In `jq` steps they are variables: `$rows`, `$c7`.
- A pipe can start from calls you already made: refer to them as `c7.out` / `$c7` instead of repeating them.
- `map` steps call a tool once per item: `{{ item }}`, `{{ item.path }}`. Items that already succeeded are skipped when the step runs again.
- `dry_run: true` checks the pipe and returns the plan without running it. `from: "<step>"` runs again from a step.

### Steps that need judgement

An `ai` step pauses the run for work only a model can do (translate, classify, summarise):

```yaml
  - id: tr
    ai: "Translate each item to Hebrew. Return a JSON array, same order, same length."
    input: '$boxes | map(.text)'
    by: subagent                  # or session
    batch: 20
    expect: { type: array, items: { type: string }, sameLengthAs: boxes }
```

The reply has `status: "paused"`, the `task`, and the input (inline for `by: session`, or as `inputHandle` per chunk for `by: subagent`).
- **`by: session`:** do the task on the input yourself, then call `pipe__resume {"run", "step", "output"}`.
- **`by: subagent`:** start one subagent per open chunk. Each one reads its input with `pipe__get {"handle": "<inputHandle>"}`, does the task and calls `pipe__resume {"run", "step", "chunk", "output"}`. Don't read the input yourself.

`output` is checked against `expect`. If it doesn't match, the reply says why and the run stays paused.

## Reusing a pipe

mcp-pipe stores no named workflows. When the user wants to keep a pipe that worked, write it into a skill: a short description of when to use it, the params, and the YAML. Next time, read the skill, change tool or column names if they differ, and pass the YAML to `pipe__run`.

## Per-item work outside a pipe

`pipe__map {"tool": "crm__update", "over": "c5.out", "args": {"id": "{{ item.id }}"}}` calls a tool once per item of a saved list in one request, and returns the counts, failures and one reference per call.
