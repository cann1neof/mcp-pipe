# Benchmarks

Measures tokens for the same task with and without mcp-pipe. Not shipped in the npm package; it is the only part of the repo that calls a model.

## Run

```bash
cp .env.example .env              # ANTHROPIC_API_KEY=...
npm run bench -- retention --runs 10            # both modes
npm run bench -- retention --runs 2 --verbose   # every turn, tool call and result
npx tsx bench/show.ts                           # exact system prompt + tools per mode
```

`BENCH_MODEL` (default `claude-opus-5-5`), `BENCH_EFFORT` (optional) in `.env`.

Results: `bench/results/<task>-<mode>.json` (per run: tokens, turns, tool calls; summary: averages, cost, success, how often `pipe__patch` was used).

## Modes

- `direct` — the task's MCP server alone.
- `pipe` — the same server behind mcp-pipe, with its server instructions and `pipe__*` tools as a host would show them.

## Tasks

- `retention` — analytics warehouse (`bench/servers/warehouse.ts`) with `run_query` and `get_table_description`; the catalog documents `usr_id` but the column is `user_id`. Prompt: *count the retention rates in the last quarter using table `users_data`*. No system prompt.

Add a task: a file in `bench/tasks/` exporting `SERVER`, `PROMPT`, `SYSTEM`, `succeeded(run)` and `hitPlantedBug(run)`, registered in `bench/run.ts`.
