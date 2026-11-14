---
name: translate-deck
description: Translate every text box of a deck into another language. Runs as one mcp-pipe pipe.
---

# Translate every text box of a deck into another language

Translate every text box of a slide deck. The AI translates; mcp-pipe moves the text in and out. Tool names assume a slides server registered as "slides" with list_text / set_text tools — adjust to yours.

Run this pipe with `pipe__run`: pass the YAML below as `chain` and fill in `params`. If the tool names differ in this session, change them to the matching tools first.

```yaml
name: translate-deck
description: Translate every text box of a deck into another language
params: { deck_id: string, lang: string }
steps:
  - id: boxes
    call: slides__list_text
    args: { deck: "{{ deck_id }}" }
  - id: tr
    ai: "Translate each item to {{ lang }}. Return a JSON array of strings, same order, same length."
    input: '$boxes | map(.text)'
    by: subagent
    batch: 20
    expect: { type: array, items: { type: string }, sameLengthAs: boxes }
  - id: merged
    jq: '$boxes | to_entries | map(.value + {text: $tr[.key]})'
  - id: write
    map: slides__set_text
    over: merged
    args: { deck: "{{ deck_id }}", slide: "{{ item.slide }}", box: "{{ item.box }}", text: "{{ item.text }}" }
```

If a step fails, fix it with `pipe__patch {"run": "<run id>", "step": "<step id>", "edits": [...]}`; the run continues from that step.
