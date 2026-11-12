# Configuration

`~/.mcp-pipe/servers.json` (or `mcp-pipe --config <file>`):

```json
{
  "mcpServers": {
    "db":     { "command": "npx", "args": ["-y", "some-db-mcp"], "env": { "DB_URL": "${env:DB_URL}" } },
    "sheets": { "url": "https://sheets.example.com/mcp", "headers": { "Authorization": "Bearer ${keychain:sheets/token}" } },
    "hr":     { "command": "hr-mcp", "pipe": { "visibility": "hidden", "allowSinks": ["sheets"] } }
  },
  "store":  { "path": "~/.mcp-pipe/store.db", "ttlDays": 7, "memoryOnly": false },
  "peek":   { "maxBytes": 8192 },
  "recipesDir": "~/.mcp-pipe/recipes"
}
```

## Servers

- stdio: `command`, `args`, `env`, `cwd` — same as Claude Desktop.
- streamable HTTP: `url`, `headers`. (OAuth for downstream servers is not supported yet.)
- `pipe`: [blind mode](./blind-mode) policy.
- The name `pipe` is reserved.
- Tools are exposed as `<server>__<tool>`; names are sanitised to `[a-zA-Z0-9_-]`, at most 64 characters, made unique with `_2`, `_3`.

## Secrets

In any string of a server entry:

- `${env:NAME}` — an environment variable (startup error naming the server and variable if missing).
- `${keychain:service/account}` — macOS keychain (`security find-generic-password -s service -a account -w`). macOS only.

## Store

- SQLite file, created with mode 600, in WAL mode.
- Calls and runs older than `ttlDays` (default 7) are deleted on start and every hour.
- `memoryOnly: true` keeps everything in memory; nothing is written to disk.
