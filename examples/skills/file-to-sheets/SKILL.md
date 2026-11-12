---
name: file-to-sheets
description: One sheet row per non-empty line of a text file. Runs as one mcp-pipe pipe.
---

# One sheet row per non-empty line of a text file

Put every non-empty line of a text file into its own sheet row. Assumes servers "fs" (@modelcontextprotocol/server-filesystem) and "sheets".

Run this pipe with `pipe__run`: pass the YAML below as `chain` and fill in `params`. If the tool names differ in this session, change them to the matching tools first.

```yaml
name: file-to-sheets
description: One sheet row per non-empty line of a text file
params: { path: string, sheet: string }
steps:
  - id: file
    call: fs__read_text_file
    args: { path: "{{ path }}" }
  - id: lines
    jq: '$file | split("\n") | map(select(. != "") | [.])'
  - id: append
    call: sheets__append_rows
    args: { sheet: "{{ sheet }}", values: "{{ lines }}" }
```

If a step fails, fix it with `pipe__patch {"run": "<run id>", "step": "<step id>", "edits": [...]}`; the run continues from that step.
