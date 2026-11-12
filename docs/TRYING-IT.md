# Trying mcp-pipe (pre-release)

mcp-pipe is not on npm yet, so you run it from this checkout.

## 1. Build

```bash
npm ci && npm run build
```

## 2a. Safest: demo database only (no host config changes)

Add one entry to your host's MCP config by hand. Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`.

Create `~/.mcp-pipe/servers.json`:

```json
{
  "mcpServers": {
    "db": { "command": "/ABS/PATH/TO/node", "args": ["/ABS/PATH/TO/mcp-pipe/dist/cli.js", "demo-db"] }
  }
}
```

Add to the host config's `mcpServers`:

```json
"mcp-pipe": { "command": "/ABS/PATH/TO/node", "args": ["/ABS/PATH/TO/mcp-pipe/dist/cli.js"] }
```

Use absolute paths (`which node`). Restart the host.

Claude Code alternative: `claude mcp add mcp-pipe -- "$(which node)" "$PWD/dist/cli.js"`

## 2b. Wrap your real servers

```bash
node dist/cli.js import claude-desktop --dry-run   # shows what would move
node dist/cli.js import claude-desktop             # moves them, writes a .bak- backup of the host config
```

Hosts: `claude-desktop`, `claude-code` (user-scope servers in `~/.claude.json` only), `cursor`.
Undo: copy the `.bak-…` file back over the host config.

## 3. Things to try

- Ask: *"Using db, count orders per country. Join users and orders on `u.usr_id`."* → the query fails →
  the AI should call `pipe__patch` with `{find: "usr_id", replace: "user_id"}` instead of rewriting the query.
- Ask for `pipe__get` with `status` → connected servers + startup errors.
- Ask for `pipe__get` with `c1.out[0]` → part of an earlier result, without re-running.

Store: `~/.mcp-pipe/store.db` (mode 600, entries older than 7 days are deleted on start).

## 4. Token benchmark (needs an API key)

```bash
cp .env.example .env        # put ANTHROPIC_API_KEY=... in it
npm run bench -- retention --runs 10           # add --verbose to see each turn
npx tsx bench/show.ts                          # exact system prompt + tools per mode
```

Task `retention`: the model gets only the prompt
`count the retention rates in the last quarter using table \`users_data\`` and no system prompt.
The database server (`bench/servers/warehouse.ts`) exposes two generic tools, `run_query` and `get_table_description`.
Its metadata catalog is stale: it documents the user column as `usr_id`, but the table has `user_id`.
Modes: `direct` (warehouse server alone) vs `pipe` (same server behind mcp-pipe, which adds its server instructions and `pipe__get` / `pipe__patch`).
Prints token and cost deltas, how often the planted bug was hit, success, and `pipe__patch` usage; writes `bench/results/retention-{direct,pipe}.json`.
Model: `BENCH_MODEL` (default `claude-opus-5-5`).
