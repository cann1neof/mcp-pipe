# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue. You will get a reply within 7 days.

## Supported versions

The latest minor release of the current major version gets security fixes.

## What mcp-pipe stores

| what | where | retention |
|---|---|---|
| tool call arguments and results | `~/.mcp-pipe/store.db` (SQLite, mode 600) | `store.ttlDays` (default 7), purged on start and hourly |
| runs (plans and their step states) | same file | same |
| recipes | `~/.mcp-pipe/recipes/` (mode 600) | until deleted |
| server config | `~/.mcp-pipe/servers.json` (mode 600 when written by `import`) | — |

`store.memoryOnly: true` writes nothing to disk.

## What it does not do

- It never calls an AI model (no API keys, no MCP sampling).
- It sends data only to the MCP servers you configure.
- Secrets given as `${env:VAR}` or `${keychain:service/account}` are resolved at start and not written to the store.

## Bulk actions, HTTP, blind mode

- Map steps, plans and recipes that use tools without `readOnlyHint: true` show the plan and need a one-time, plan-bound confirm token (valid 10 minutes).
- `--http` binds to 127.0.0.1 with DNS-rebinding protection and has no authentication; put your own auth in front before exposing it.
- Blind mode prevents accidental exposure of hidden data to the AI; it does not defend against a malicious agent (the AI still writes the queries and sees shapes). See the docs for its limits.

## Releases

Releases are published to npm from GitHub Actions with npm provenance, only after typecheck, tests and build pass on the tagged commit.
