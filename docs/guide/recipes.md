# Recipes

A recipe is a saved chain with parameters: the same steps, run the same way every time.

```
pipe__save    {"run": "r4", "name": "revenue-to-sheet", "description": "Revenue per country into a sheet"}
pipe__recipes {}
pipe__run     {"recipe": "revenue-to-sheet", "params": {"sheet": "Q4"}}
```

- Files live in `recipesDir` (default `~/.mcp-pipe/recipes`) as YAML; `.yml` and `.json` are read too.
- Names: letters, digits, `-`, `_`. Saving over an existing recipe needs `overwrite: true`.
- Params are checked (present, right type) before any step runs.

## File format

```yaml
recipe: sql-to-sheets
description: Query a database and append the result, with a header row, to a sheet
params: { sql: string, sheet: string }       # string | number | boolean | array | object
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

YAML is only the container; the data work is jq. Example recipes ship in the package under `recipes/examples/`: `translate-deck`, `sql-to-sheets`, `file-to-sheets`, `paper-to-file`, `compare-sources`. Their tool names assume particular server names — adjust them to yours.

## Recipes as skills

Instead of a skill that says "call tool A, then B, then C", a skill can say "run recipe X". `templates/skill-run-recipe.md` in the package is a Claude Code skill that runs any recipe and handles confirms, pauses and failures.
