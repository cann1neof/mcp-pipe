# Pipes in skills

mcp-pipe has no recipe store. A pipe worth keeping goes into a skill, the way your harness (Claude Code, Codex, Cursor, …) already keeps reusable instructions:

````markdown
---
name: sql-to-sheets
description: Query a database and append the result, with a header row, to a sheet.
---

Run the pipe below with `pipe__run`: pass the YAML as `chain` and fill in `params`.

```yaml
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
````

The user says "use the sql-to-sheets skill for …". The AI reads the skill, changes tool or column names if they differ in this session, and sends the YAML text as `chain` with the `params`. Writing the pipe out costs a few hundred tokens once per run; the data itself never passes through the conversation.

Examples ship in the package under `examples/skills/`: `translate-deck`, `sql-to-sheets`, `file-to-sheets`, `paper-to-file`, `compare-sources`.

To turn a pipe that just worked into a skill, ask the AI to write it into a skill file.
