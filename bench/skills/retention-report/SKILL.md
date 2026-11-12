---
name: retention-report
description: Monthly signup-cohort retention for a quarter from the events table, written to a new spreadsheet and summarised in a chat channel. Use when asked for a retention report.
---

# Retention report

Run the pipe below with `pipe__run`: pass the YAML as `chain` and fill in `params`
(`table`, `user_col`, `from`, `to` as dates `YYYY-MM-DD`, and `channel`).
If a tool or column name differs in this session, change it in the YAML before running.

```yaml
name: retention-report
params: { table: string, user_col: string, from: string, to: string, channel: string }
steps:
  - id: cohorts
    call: db__run_query
    args:
      sql: |
        WITH u AS (SELECT {{ user_col }} AS uid, MIN(signup_date) AS sd FROM {{ table }} GROUP BY {{ user_col }}
                   HAVING sd BETWEEN '{{ from }}' AND '{{ to }}'),
             a AS (SELECT DISTINCT {{ user_col }} AS uid, substr(event_time, 1, 7) AS m FROM {{ table }})
        SELECT substr(u.sd, 1, 7) AS cohort, COUNT(DISTINCT u.uid) AS users,
          COUNT(DISTINCT CASE WHEN a.m = strftime('%Y-%m', substr(u.sd, 1, 7) || '-01', '+1 month') THEN u.uid END) AS m1,
          COUNT(DISTINCT CASE WHEN a.m = strftime('%Y-%m', substr(u.sd, 1, 7) || '-01', '+2 month') THEN u.uid END) AS m2,
          COUNT(DISTINCT CASE WHEN a.m = strftime('%Y-%m', substr(u.sd, 1, 7) || '-01', '+3 month') THEN u.uid END) AS m3
        FROM u LEFT JOIN a ON a.uid = u.uid GROUP BY cohort ORDER BY cohort
  - id: table_rows
    jq: |
      def pct(n; d): if d == 0 then "" else ((n * 1000 / d | round) / 10 | tostring) + "%" end;
      [["Signup cohort", "Users", "Month 1", "Month 2", "Month 3"]]
      + ($cohorts | map([.cohort, .users, pct(.m1; .users), pct(.m2; .users), pct(.m3; .users)]))
  - id: sheet
    call: sheets__create_spreadsheet
    args: { title: "Retention {{ from }} to {{ to }}" }
  - id: write
    call: sheets__update_values
    args: { spreadsheet_id: "{{ sheet.spreadsheet_id }}", start_cell: "A1", values: "{{ table_rows }}" }
  - id: summary
    jq: |
      "*Retention, signups \($from) to \($to)*\n"
      + ($table_rows[1:] | map("• \(.[0]): \(.[1]) users, month 1 \(.[2]), month 2 \(.[3]), month 3 \(.[4])") | join("\n"))
      + "\nFull table: \($sheet.url)"
  - id: post
    call: chat__post_message
    args: { channel: "{{ channel }}", text: "{{ summary }}" }
```

Months that are not over yet show partial numbers; say so when you report the result.
If a step fails, fix it with `pipe__patch {"run": "<run id>", "step": "<step id>", "edits": [...]}`; the run continues from that step.
