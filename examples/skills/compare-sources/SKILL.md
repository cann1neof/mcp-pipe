---
name: compare-sources
description: Compare a metric across two systems and explain where they disagree. Runs as one mcp-pipe pipe.
---

# Compare a metric across two systems and explain where they disagree

Pull the same metric from two systems and let the AI explain the differences — it reads only the diff. Assumes servers "db" and "crm" with query tools returning [{id, value}].

Run this pipe with `pipe__run`: pass the YAML below as `chain` and fill in `params`. If the tool names differ in this session, change them to the matching tools first.

```yaml
name: compare-sources
description: Compare a metric across two systems and explain where they disagree
params: { db_sql: string, crm_query: string }
steps:
  - id: a
    call: db__query
    args: { sql: "{{ db_sql }}" }
  - id: b
    call: crm__query
    args: { query: "{{ crm_query }}" }
  - id: diff
    jq: '($b | map({(.id|tostring): .value}) | add // {}) as $bm | $a | map(select(.value != $bm[.id|tostring]) | {id, db: .value, crm: $bm[.id|tostring]})'
  - id: explain
    ai: "These records disagree between the database and the CRM. Group them by likely cause and summarise in a few bullet points."
    input: '$diff'
    by: session
```

If a step fails, fix it with `pipe__patch {"run": "<run id>", "step": "<step id>", "edits": [...]}`; the run continues from that step.
