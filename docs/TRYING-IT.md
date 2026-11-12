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
npm run bench -- sql-fix --runs 10
```

Runs the same task (a 56-line report query with one wrong column) with the demo DB direct vs behind mcp-pipe.
Writes `bench/results/sql-fix-{direct,pipe}.json` and prints output/total token deltas and how often `pipe__patch` was used.
Model: `BENCH_MODEL` (default `claude-opus-5-5`). ~20 short agent runs; each is a few thousand tokens.
