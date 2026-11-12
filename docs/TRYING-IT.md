# Trying mcp-pipe from this checkout

Until the npm release, run it from source:

```bash
npm ci && npm run build
```

Then follow the [install guide](guide/install.md), replacing `npx -y mcp-pipe` with `node /ABS/PATH/TO/mcp-pipe/dist/cli.js` (use absolute paths; `which node` for node). `node dist/cli.js import claude-desktop` writes that form for you.

Things to try once connected:

- **Patch**: *"Using db, count orders per country. Join users and orders on `u.usr_id`."* → the query fails → the AI fixes it with `pipe__patch`.
- **Refs**: ask for a query, then *"put those rows into …"* — the AI can pass `{{ c1.out }}` instead of copying rows.
- **Plan**: *"Run this as one plan: query revenue per country, turn it into a table with a header row, and write it to …"* → `pipe__run`.
- **Status**: `pipe__get` with handle `status`.

Benchmarks: [bench/README.md](../bench/README.md).
