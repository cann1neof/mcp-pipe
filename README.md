# mcp-pipe

Copy/paste for AI tool calls. A self-hosted MCP proxy that gives every tool call a handle, so the AI can fix a call by patch, pipe one tool's output into another, and save chains as recipes — instead of re-typing data.

Status: early development (M1 — core proxy). Try it: [docs/TRYING-IT.md](docs/TRYING-IT.md).

## What works now
- Wraps any stdio MCP servers; their tools appear as `<server>__<tool>`.
- Every call gets a handle `⟨pipe:cN⟩`.
- `pipe__patch` — fix a call with find/replace edits and rerun it, instead of re-typing it.
- `pipe__get` — fetch a stored argument/result (or a path inside it) by handle.
- `mcp-pipe import <claude-desktop|claude-code|cursor>` — move a host's servers behind mcp-pipe.

License: MIT
