# Changelog

## Unreleased

- The usage skill (`skills/mcp-pipe/SKILL.md`, `mcp-pipe install-skill`) holds all guidance on how to use the tools; tool descriptions, server instructions and replies only describe what the tools do (no `next` hints).
- `pipe__transform` refuses a filter whose output does not depend on its input.
- Results end with `saved as {{ cN.out }}` (was `⟨pipe:cN⟩`): the label is the ref that passes the result on.
- A ref can be any jq expression over saved results: `{{ [["a","b"]] + (c3.out | map([.a, .b])) }}`.
- Array/object arguments sent as JSON text are parsed before forwarding.
- Confirm tokens are off by default; `confirmWrites: true` turns them on.
- Removed `pipe__save`, `pipe__recipes`, `pipe__define` and `recipesDir`: keep pipes in skills and pass them to `pipe__run` as text (`dry_run` replaces define). Example recipes are now `examples/skills/`.

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
