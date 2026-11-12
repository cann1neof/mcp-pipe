# Refs and jq

Any argument of any tool can refer to a stored value:

```
{{ <name>[.path] [| <jq filter>] }}
```

- `name` — a handle (`c3.out`, `c3.in`); inside a [plan](./chains) also a param, an earlier step id, or `item` (in `map`).
- `.path` — part of the value: `.rows[0].name`.
- `| jq` — any jq filter applied to it: `| map(.id)`, `| .[0:4]`, `| length`.

## Whole string vs. inside text

::: v-pre
| argument | result |
|---|---|
| `"{{ c3.out.rows }}"` | the value itself, with its type (here an array) |
| `"{{ c3.out \| length }}"` | a number |
| `"id LIKE '{{ c1.out.hash \| .[0:4] }}%'"` | text: `id LIKE 'a1b2%'` |
| `"rows: {{ c3.out.rows }}"` | text with the rows as JSON |
| `"Hello \\{{ name }}"` | literal `Hello {{ name }}` (escaped) |
:::

Text with `{{ … }}` that is not a known name is an error ("unknown handle"), so a template meant literally must be escaped with `\{{`.

Tools whose schema expects a number, array or object accept a ref string in that place: mcp-pipe widens the schemas it exposes (`anyOf: [original, ref string]`). If a ref resolves to the wrong type, the downstream error comes back with a hint like `{{ c3.out }} resolved to {a:number}`.

Stored arguments keep the ref text, not the resolved data, so `pipe__patch` edits the ref.

## jq

jq is the only transform language — no custom rule language. Examples:

```jq
(.[0]|keys_unsorted) as $k | [$k] + map([.[$k[]]])   # SQL rows → sheet rows with a header
split("\n") | map(select(. != "") | [.])              # text → one row per line
gsub("class="; "className=")                          # HTML → JSX attributes
```

- A filter with one output gives that value, no output gives `null`, several outputs give an array.
- Errors name the input's shape: `Cannot index array with "foo" (input: array[2] of {id:number,…})`.
- Filters run in a worker thread with a 5-second limit.

## pipe__transform

Store a reshaped value under a new handle without it passing through the conversation:

```json
{ "from": "c3.out", "jq": "map({name, total})" }
```
