# AI steps

mcp-pipe never calls a model. Steps that need judgement — translate, classify, summarise — pause the run and hand the work to the AI that is already in the conversation, or to a subagent.

```yaml
- id: tr
  ai: "Translate each item to {{ lang }}. Return a JSON array of strings, same order, same length."
  input: '$boxes | map(.text)'      # jq over params and earlier steps
  by: subagent                      # session (default) | subagent
  batch: 20                         # optional: split the input into chunks
  expect: { type: array, items: { type: string }, sameLengthAs: boxes }
```

## The pause

`pipe__run` stops at the step:

```json
{
  "status": "paused", "run": "r2", "step": "tr", "by": "subagent",
  "task": "Translate each item to Hebrew. Return a JSON array of strings, same order, same length.",
  "chunks": [{ "index": 0, "inputHandle": "c21.out" }, { "index": 1, "inputHandle": "c22.out" }],
  "next": "Spawn a subagent per open chunk … pipe__get({\"handle\":\"<inputHandle>\"}) … pipe__resume(…)"
}
```

- `by: session` — the input is included in the reply; the AI does the task itself.
- `by: subagent` — only handles are returned. A subagent reads its input with `pipe__get`, does the task and calls `pipe__resume` itself, so the main conversation never holds the data. Works in hosts where subagents share MCP tools (e.g. Claude Code); elsewhere use `session`.
- `batch: n` splits a list input into chunks of n; chunks can be resumed in any order (in parallel), and the outputs are joined in chunk order.

## Resume

```json
{ "run": "r2", "step": "tr", "chunk": 0, "output": ["…", "…"] }
```

- `output` is checked against `expect` (a JSON Schema; `sameLengthAs: <step>` requires the same length as that step's output — per chunk when batched).
- On mismatch the reply is `{status: "rejected", reason}` and the run stays paused.
- JSON sent as a string (`"[\"a\",\"b\"]"`) is parsed once.
- When the last chunk is in, the run continues; nothing before the AI step runs again.

An `ai` step cannot read [hidden](./blind-mode) data: such a run fails at that step.
