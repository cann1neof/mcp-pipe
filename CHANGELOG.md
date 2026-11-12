# Changelog

## 1.0.0 — unreleased

First public release.

### Core proxy
- Wraps stdio and streamable-HTTP MCP servers; tools exposed as `<server>__<tool>`; one failing server never blocks the others.
- Every call stored with a handle (`⟨pipe:cN⟩`); `pipe__get` reads args/results by handle, path and jq.
- `pipe__patch`: re-run a call with find/replace or set edits.
- `mcp-pipe import <claude-desktop|claude-code|cursor>` with dry run and backup; `mcp-pipe demo-db`.
- `mcp-pipe --http <port>`: host side over streamable HTTP.

### Pipes
- `{{ name[.path] [| jq] }}` refs in any argument; schema widening so non-string arguments accept refs.
- jq transforms (`pipe__transform`), `pipe__map` with concurrency, peek for large results.
- Confirm tokens and dry runs for bulk work on tools that can change data.
- Blind mode: hidden servers/tools, taint propagation, masked errors, allowed sinks.
- `${env:}` and `${keychain:}` secrets; store TTL purge; memory-only store.

### Plans and recipes
- `pipe__run` / `pipe__define`: chains of call, jq, map and ai steps; failures patched per step and re-run from it; runs survive restarts.
- `ai` steps pause the run for the session or a subagent; batching; `pipe__resume` validates against `expect`.
- Idempotent map steps; `pipe__save`, `pipe__recipes`; example recipes and a Claude Code skill template.
