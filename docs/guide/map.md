# Map

`pipe__map` calls one tool once per item of a stored list — one request from the AI, N calls downstream.

```json
{
  "tool": "sheets__append_row",
  "over": "c3.out",
  "args": { "sheet": "Q3", "row": ["{{ item.name }}", "{{ item.total }}"] },
  "concurrency": 4
}
```

- `over` — a handle of a list, optionally with jq: `"{{ c3.out | map(select(.total > 100)) }}"`.
- `{{ item }}` is the current item; `{{ item.<path> }}` part of it.
- Reply: `{ ok, failed: [{index, error}], handles, outputs }` — counts and handles, never the outputs themselves. `outputs` is the handle of the list of all outputs, in item order.
- An item that fails does not stop the others.

## Optional confirm for tools that can change data

Off by default: maps run directly. With `confirmWrites: true` in the config, a map over a tool without `readOnlyHint: true` (which counts as writing) first replies with a plan and a one-time token:

```json
{ "status": "needs_confirm", "plan": [{ "tool": "sheets__append_row", "count": 120, "writes": true }], "confirm": "ok-3f9a…" }
```

The AI shows the plan; repeating the call with `"confirm": "ok-3f9a…"` runs it. Tokens are bound to the exact plan, work once, and expire after 10 minutes. `dry_run: true` returns the plan without running anything.
