# mcp-pipe

**Copy/paste for AI tool calls.** A self-hosted MCP proxy that works with any host and any MCP server: every tool call gets a handle, so the AI moves data by reference, fixes calls by patch, and runs whole plans in one request — instead of re-typing data it already has.

[Docs](https://cann1neof.github.io/mcp-pipe/) · [pipe__* reference](https://cann1neof.github.io/mcp-pipe/reference/ops) · [Security](SECURITY.md) · MIT

## The problem

1. **Fixing a call means rewriting it.** One wrong column in a 60-line SQL query, and the AI sends all 60 lines again.
2. **Moving data means copying it.** Query rows → a slide deck or a sheet: the AI reads the rows, then types them back out into the next tool.
3. **Lists mean one call per item.** 200 lines of a file → 200 rows in a sheet, one tool call (and one generated argument) at a time.

Output tokens are the slow, expensive part, and hand-copying is where mistakes creep in.

## Quickstart

Requires Node.js 22+.

```bash
npx -y mcp-pipe import claude-desktop --dry-run   # see what moves
npx -y mcp-pipe import claude-desktop             # move your servers behind mcp-pipe (backup written)
```

Restart Claude Desktop. Your tools are now `<server>__<tool>`, plus the `pipe__*` tools. Also: `claude-code`, `cursor`, or [add it by hand](https://cann1neof.github.io/mcp-pipe/guide/install).

No servers to try it on? `npx -y mcp-pipe demo-db` is a demo SQLite shop database you can wrap.

## How it works

```
host (Claude Desktop / Claude Code / Cursor / your agent)
   │  sees one MCP server
   ▼
mcp-pipe ── store: every call's args + result under a handle (c1, c2, …), runs, recipes
   │  resolves "{{ c3.out.rows | jq }}" to real values, then forwards
   ▼
your MCP servers (postgres, sheets, slides, filesystem, …)
```

| the AI wants to… | it sends |
|---|---|
| fix a call | `pipe__patch {"call":"c3","edits":[{"find":"usr_id","replace":"user_id"}]}` |
| pass data on | `sheets__append_rows {"values":"{{ c3.out \| map([.country, .revenue]) }}"}` |
| call a tool per item | `pipe__map {"tool":"crm__update","over":"c5.out","args":{"id":"{{ item.id }}"}}` |
| run a whole plan | `pipe__run {"chain":{"steps":[…]}}` — calls, jq, per-item calls and AI pauses in one request |
| reuse it | `pipe__save` → `pipe__run {"recipe":"revenue-to-sheet","params":{…}}` |

Large results come back as a shape + first rows + handle ([peek](https://cann1neof.github.io/mcp-pipe/guide/peek)).

## A recipe

```yaml
recipe: translate-deck
params: { deck_id: string, lang: string }
steps:
  - id: boxes
    call: slides__list_text
    args: { deck: "{{ deck_id }}" }
  - id: tr                                   # the AI (or a subagent) translates; the run pauses here
    ai: "Translate each item to {{ lang }}. Return a JSON array, same order, same length."
    input: '$boxes | map(.text)'
    by: subagent
    batch: 20
    expect: { type: array, items: { type: string }, sameLengthAs: boxes }
  - id: merged
    jq: '$boxes | to_entries | map(.value + {text: $tr[.key]})'
  - id: write
    map: slides__set_text
    over: merged
    args: { deck: "{{ deck_id }}", slide: "{{ item.slide }}", box: "{{ item.box }}", text: "{{ item.text }}" }
```

The proxy never calls a model: `ai` steps pause the run and are done by the AI in your conversation, or by a subagent that reads its input by handle, so the main context never holds the deck.

## Security in short

- Local store (SQLite, mode 600), entries deleted after 7 days; or memory-only.
- `${env:VAR}` / `${keychain:service/account}` secrets in config.
- Bulk work on tools that can change data shows the plan first and needs a one-time confirm token.
- **Blind mode**: mark a server hidden and its data flows through plans to allowed destinations without reaching the AI.
- Never calls an AI model; talks only to the servers you configured.

Details: [SECURITY.md](SECURITY.md) · [docs/security](https://cann1neof.github.io/mcp-pipe/security).

## How it compares

| | plain MCP calls | code mode / programmatic tool calling | declarative tool chainers | **mcp-pipe** |
|---|---|---|---|---|
| works in any MCP host | ✅ | ❌ needs a specific API/runtime | ✅ | ✅ |
| AI writes code | no | yes, in a sandbox | no | no (jq for reshaping) |
| fix a call without resending it | ❌ | ❌ | ❌ | ✅ patch + rerun |
| data between tools by reference | ❌ | ✅ inside the script | ✅ | ✅ in any call or plan |
| saved, parameterised workflows | ❌ | ❌ | partly | ✅ recipes |
| steps that need judgement | — | ❌ | ❌ | ✅ AI pause steps |
| hide data from the AI | ❌ | partly | ❌ | ✅ blind mode |

## Benchmarks

Not published yet. Every number will link to a result file in [`bench/results/`](bench/results), including where mcp-pipe does not help. How to run them: [bench/README.md](bench/README.md).

## Contributing

```bash
npm ci
npm test && npm run typecheck
npm run docs:dev
```

Issues and PRs welcome. Conventional commits; every change ends green on `npm test && npm run typecheck`.

## License

MIT
