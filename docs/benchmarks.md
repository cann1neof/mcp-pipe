# Benchmarks

No results are published yet. Every savings number in these docs will link to a result file in [`bench/results/`](https://github.com/cann1neof/mcp-pipe/tree/main/bench/results), including tasks where mcp-pipe does not help.

## How the benchmark works

- `bench/agent.ts` runs a plain tool-use loop against an MCP server and sums input, cache and output tokens per run.
- Each task runs in two modes with the same model and prompt:
  - **direct** — the MCP server alone;
  - **pipe** — the same server behind mcp-pipe (which adds its server instructions and `pipe__*` tools, as a host would see them).
- Task `retention`: an analytics database with two generic tools (`run_query`, `get_table_description`) whose metadata catalog is stale (`usr_id` documented, `user_id` real). The model gets only *"count the retention rates in the last quarter using table `users_data`"*, with no system prompt.

Reproduce: see [bench/README.md](https://github.com/cann1neof/mcp-pipe/blob/main/bench/README.md).
