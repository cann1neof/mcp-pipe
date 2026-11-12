---
name: paper-to-file
description: Write a Paper node's JSX to a file, converting class= to className=. Runs as one mcp-pipe pipe.
---

# Write a Paper node's JSX to a file, converting class= to className=

Copy a design's JSX from Paper into a source file without the AI regenerating it. Assumes servers "paper" (get_jsx) and "fs" (write_file).

Run this pipe with `pipe__run`: pass the YAML below as `chain` and fill in `params`. If the tool names differ in this session, change them to the matching tools first.

```yaml
name: paper-to-file
description: Write a Paper node's JSX to a file, converting class= to className=
params: { node_id: string, path: string }
steps:
  - id: jsx
    call: paper__get_jsx
    args: { nodeId: "{{ node_id }}" }
  - id: code
    jq: '$jsx | if type == "object" then (.jsx // .code // tostring) else . end | gsub("class="; "className=")'
  - id: write
    call: fs__write_file
    args: { path: "{{ path }}", content: "{{ code }}" }
```

If a step fails, fix it with `pipe__patch {"run": "<run id>", "step": "<step id>", "edits": [...]}`; the run continues from that step.
