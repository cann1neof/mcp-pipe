---
name: sql-to-sheets
description: Query a database and append the result, with a header row, to a sheet. Runs as one mcp-pipe pipe.
---

# Query a database and append the result, with a header row, to a sheet

Run a query and append the rows (with a header row) to a spreadsheet — no rows pass through the AI. Assumes servers "db" (query tool) and "sheets" (append_rows tool).

Run this pipe with `pipe__run`: pass the YAML below as `chain` and fill in `params`. If the tool names differ in this session, change them to the matching tools first.

```yaml
name: sql-to-sheets
description: Query a database and append the result, with a header row, to a sheet
params: { sql: string, sheet: string }
steps:
  - id: rows
    call: db__query
    args: { sql: "{{ sql }}" }
  - id: table
    jq: '($rows[0] | keys_unsorted) as $k | [$k] + ($rows | map([.[$k[]]]))'
  - id: append
    call: sheets__append_rows
    args: { sheet: "{{ sheet }}", values: "{{ table }}" }
```

If a step fails, fix it with `pipe__patch {"run": "<run id>", "step": "<step id>", "edits": [...]}`; the run continues from that step.
