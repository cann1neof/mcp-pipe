# Handles, get and patch

Every tool call made through mcp-pipe is stored, and its result ends with a handle:

```
[{"country":"IL","orders":112}, …]
⟨pipe:c3⟩
```

- `c3.out` — the result of call 3 (parsed JSON if the result is JSON text)
- `c3.in` — the arguments of call 3
- a path reads part of a value: `c3.out[0].country`, `c3.in.sql`, `c3.out["a key"]`

## pipe__get

Read a stored value, optionally through a jq filter:

```json
{ "handle": "c3.out", "jq": "map(.country)" }
```

`{ "handle": "status" }` returns connected servers and startup errors.

## pipe__patch

Re-run a call with small edits instead of sending it again.

```json
{ "call": "c3", "edits": [{ "find": "usr_id", "replace": "user_id" }] }
```

Edit forms:

| edit | effect |
|---|---|
| `{find, replace}` | replaces every occurrence of the text in all string arguments |
| `{find, replace, path}` | only under `path`, e.g. `"sql"` |
| `{path, set}` | sets the value at `path`, e.g. `{"path": "limit", "set": 100}` |

- No edits → the call is re-run unchanged.
- A `find` with no match is an error, and nothing runs.
- The patched call gets its own handle (`c4`); `c3` is kept.
- `run: false` stores the patched call without running it.

To fix a step of a [plan](./chains), pass `run` and `step` instead of `call`.
