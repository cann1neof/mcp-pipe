# Security

## What mcp-pipe stores, where, for how long

| what | where | how long |
|---|---|---|
| every call's arguments and result | `~/.mcp-pipe/store.db` (SQLite, file mode 600) | `store.ttlDays`, default 7 days; purged on start and hourly |
| runs (chains, step states) | same file | same |
| recipes | `~/.mcp-pipe/recipes/*.yaml` (mode 600) | until you delete them |
| server config | `~/.mcp-pipe/servers.json` (mode 600 when written by `import`) | — |

`store.memoryOnly: true` keeps calls and runs in memory only.

Secrets: use `${env:VAR}` or `${keychain:service/account}` in `servers.json` instead of plain values. They are resolved when mcp-pipe starts and passed to the downstream server; they are not written to the store (only the tool arguments the AI sends are).

## What it never does

- It never calls an AI model: no API keys, no MCP sampling. `ai` steps pause and wait for the AI in your conversation.
- It sends nothing anywhere except to the MCP servers you configured.

## Bulk actions are visible

Map steps, plans and recipes that use tools without `readOnlyHint: true` first return the full plan and a one-time confirm token. The host's approval prompt for the confirming call shows the token and plan. `dry_run` shows the plan without running anything.

## HTTP mode

`mcp-pipe --http` binds to 127.0.0.1 by default and rejects requests whose `Host` header is not local (DNS-rebinding protection). It has no authentication: do not expose it to a network without your own auth in front.

## Blind mode

See [Blind mode](./guide/blind-mode), including its limits: it protects against accidental exposure, not a malicious agent.

## Prompt injection

Data that moves by ref never enters the AI's context, which shrinks the surface for injected instructions. Results the AI does read (normal results, `ai` step inputs in `session` mode) are as risky as without mcp-pipe.

## Reporting a vulnerability

See [SECURITY.md](https://github.com/cann1neof/mcp-pipe/blob/main/SECURITY.md).
