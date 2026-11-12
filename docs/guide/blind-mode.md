# Blind mode

Mark a server (or one tool) hidden, and its data can be processed by plans and sent to allowed destinations without ever appearing in a response to the AI.

```json
"hr-db": {
  "command": "…",
  "pipe": {
    "visibility": "hidden",
    "shape": "types",
    "errors": "class",
    "allowSinks": ["sheets", "filesystem"],
    "tools": { "list_tables": { "visibility": "visible" } }
  }
}
```

| key | values | default |
|---|---|---|
| `visibility` | `visible`, `hidden` | `visible` |
| `shape` | what the AI sees of a hidden value: `full` (types + counts), `types` (keys and types, no counts), `none` | `full` |
| `errors` | `class` (first line, quoted text and numbers masked), `full` | `class` when hidden |
| `allowSinks` | servers hidden data may be sent to; anything else is refused before the call | all |
| `tools` | per-tool overrides (e.g. keep the schema tool visible so the AI can write queries) | — |

## What happens

- A hidden tool's result comes back as `⟨pipe:c3⟩ hidden · {name:string,salary:number}` (per `shape`).
- **Taint spreads**: anything derived from a hidden value is hidden too — jq transforms, refs in arguments, map items and outputs, and results of calls whose arguments used hidden data.
- `pipe__get` on a hidden value is refused.
- A call that would send hidden data to a server not in `allowSinks` is refused before anything is sent.
- `ai` steps cannot read hidden data.

## Limits

Blind mode protects against accidental exposure, not against a malicious agent:

- The AI still sees its own queries and the shape of results; with `shape: full` it could probe with counts. `shape: none` closes that.
- The host may log the tool arguments the AI wrote.
- Data sent to an allowed sink is then subject to that server.
