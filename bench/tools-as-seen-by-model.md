# What the model sees from mcp-pipe

Generated from `src/proxy.ts` OPS. Downstream tools appear next to these as `<server>__<tool>` with their own descriptions.

## Server instructions

Every tool result from this server ends with a handle like ⟨pipe:c3⟩ that refers to the stored call  (its arguments and its result). Any argument of any tool may be a reference "{{ c3.out.path | jq }}" to a  stored value, so data can move between tools without being copied. To repeat a call with a change (after an  error, or to adjust it), use pipe__patch and send only the change instead of the whole call. pipe__get reads a  stored value or part of it; pipe__transform reshapes one with jq; pipe__map calls a tool once per item of a stored  list. For work with several steps: look at the inputs with single calls first, then write the remaining steps as  one plan and execute it with pipe__run (tool calls, jq steps, per-item calls and pauses for judgement) instead of  calling the tools one by one. Working plans can be saved as recipes (pipe__save) and run again by name. 

## pipe__get

Read the arguments or the result of an earlier tool call by its handle. Handle forms: "c3.out" (result), "c3.in" (arguments); add a path to read part of a value, e.g. "c3.out.items[0].id". Optional "jq" applies a jq filter to the value first. "status" returns the connected servers and any startup errors.

```json
{
  "type": "object",
  "properties": {
    "handle": {
      "type": "string",
      "description": "call handle with optional path, or \"status\""
    },
    "jq": {
      "type": "string",
      "description": "optional jq filter applied to the value"
    }
  },
  "required": [
    "handle"
  ]
}
```

## pipe__patch

Re-run an earlier tool call with modified arguments. Use it whenever a call needs to be repeated with a change — it failed, or you want a different filter, column, limit or target — instead of writing the whole call again: you send only the change, and the arguments stay exactly as they were everywhere else. The call's stored arguments are copied, the edits are applied to the copy, and the result is executed as a new call with its own handle. Edit forms: {find, replace} replaces text in string arguments (all of them, or only under "path"); {path, set} sets the value at "path". With no edits the call is re-run unchanged. To fix a step of a run instead, pass "run" (run id) and "step": the edits apply to the step definition (e.g. path "args.sql", or find/replace in its text) and the run continues from that step; earlier steps are not repeated.

```json
{
  "type": "object",
  "properties": {
    "call": {
      "type": "string",
      "description": "handle of the call, e.g. \"c3\""
    },
    "run": {
      "description": "run id (with \"step\"); or, with \"call\", false to only store the new call",
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "boolean"
        }
      ]
    },
    "step": {
      "type": "string",
      "description": "step id inside the run"
    },
    "edits": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "find": {
            "type": "string"
          },
          "replace": {
            "type": "string"
          },
          "path": {
            "type": "string",
            "description": "path inside the arguments / step, e.g. \"a.b[0]\""
          },
          "set": {
            "description": "new value for \"path\""
          }
        }
      }
    },
    "rerun": {
      "type": "boolean",
      "description": "with run+step: continue the run after patching (default true)"
    },
    "confirm": {
      "type": "string",
      "description": "token from a needs_confirm reply"
    }
  }
}
```

## pipe__transform

Reshape a stored value with a jq filter and store the output under a new handle, without the data passing through the conversation. "from" is a handle with optional path (e.g. "c3.out.items").

```json
{
  "type": "object",
  "properties": {
    "from": {
      "type": "string",
      "description": "handle of the input value, e.g. \"c3.out\""
    },
    "jq": {
      "type": "string",
      "description": "jq filter"
    }
  },
  "required": [
    "from",
    "jq"
  ]
}
```

## pipe__map

Call one tool once per item of a stored list, in a single request. "over" is a handle of a list (e.g. "c3.out.rows", or "{{ c3.out | map(.id) }}"). In "args", "{{ item }}" is the current item and "{{ item.<path> }}" part of it. Returns how many calls succeeded, the failures, and a handle per call; the outputs are stored as a list under the map's own handle. Tools that can change data need a confirm: the first reply is the plan and a token, then repeat the call with "confirm". "dry_run" returns the plan only.

```json
{
  "type": "object",
  "properties": {
    "tool": {
      "type": "string",
      "description": "tool name as listed, e.g. \"server__tool\""
    },
    "over": {
      "type": "string",
      "description": "handle of the list to iterate"
    },
    "args": {
      "type": "object",
      "description": "arguments for each call; may use {{ item }} refs"
    },
    "concurrency": {
      "type": "number",
      "description": "parallel calls (default 4)"
    },
    "dry_run": {
      "type": "boolean"
    },
    "confirm": {
      "type": "string",
      "description": "token from a needs_confirm reply"
    }
  },
  "required": [
    "tool",
    "over",
    "args"
  ]
}
```

## pipe__run

Run a multi-step plan in one request: pass a new "chain", an existing "run" id, or a saved "recipe" name with "params". Use it as soon as you know the remaining steps — typically after a few single calls to look at the inputs — and especially when one step's result feeds the next: the steps run back to back without a round trip to you, intermediate results stay stored instead of passing through the conversation, and a failed step is fixed in place. A chain is {params?: {name: type}, steps: [...]}; each step has an "id" and one of: {call: "<tool>", args: {...}} calls a tool; {jq: "<program>"} computes a value, with params and earlier step outputs as jq variables ($id); {map: "<tool>", over: "<step id or handle of a list>", args: {...}} calls a tool once per item ("{{ item }}", "{{ item.path }}"); {ai: "<task>", input?: "<jq program>", by?: "session"|"subagent", batch?: n, expect?: <JSON Schema>} pauses the run for a step that needs judgement (done by you or a subagent), continued with pipe__resume. In args, "{{ name[.path] [| jq] }}" refers to a param, an earlier step's output, or any handle. The reply lists each step's output handle and the last step's result. A failing step stops the run; fix it with pipe__patch {run, step, edits}, which re-runs from that step without repeating earlier ones. Plans with tools that can change data need a confirm: the first reply is the plan and a token, then repeat the call with "confirm". "from" re-runs from a step; "dry_run" returns the plan; "force" repeats map items that already succeeded.

```json
{
  "type": "object",
  "properties": {
    "chain": {
      "description": "chain object (or YAML/JSON text)"
    },
    "params": {
      "type": "object",
      "description": "values for the chain's params"
    },
    "run": {
      "type": "string",
      "description": "existing run id, e.g. \"r1\""
    },
    "recipe": {
      "type": "string",
      "description": "saved recipe name"
    },
    "from": {
      "type": "string",
      "description": "step id to run again from"
    },
    "dry_run": {
      "type": "boolean"
    },
    "confirm": {
      "type": "string",
      "description": "token from a needs_confirm reply"
    },
    "force": {
      "type": "boolean"
    }
  }
}
```

## pipe__define

Validate a chain and store it as a run without executing it. Returns the run id and its plan. A chain is {params?: {name: type}, steps: [...]}; each step has an "id" and one of: {call: "<tool>", args: {...}} calls a tool; {jq: "<program>"} computes a value, with params and earlier step outputs as jq variables ($id); {map: "<tool>", over: "<step id or handle of a list>", args: {...}} calls a tool once per item ("{{ item }}", "{{ item.path }}"); {ai: "<task>", input?: "<jq program>", by?: "session"|"subagent", batch?: n, expect?: <JSON Schema>} pauses the run for a step that needs judgement (done by you or a subagent), continued with pipe__resume. In args, "{{ name[.path] [| jq] }}" refers to a param, an earlier step's output, or any handle.

```json
{
  "type": "object",
  "properties": {
    "chain": {
      "description": "chain object (or YAML/JSON text)"
    },
    "params": {
      "type": "object",
      "description": "values for the chain's params"
    }
  },
  "required": [
    "chain"
  ]
}
```

## pipe__resume

Give the result of a paused ai step and continue its run. "output" is checked against the step's "expect"; if it does not match, the reply says why and the run stays paused. For a batched step, resume each chunk by its index.

```json
{
  "type": "object",
  "properties": {
    "run": {
      "type": "string"
    },
    "step": {
      "type": "string"
    },
    "chunk": {
      "type": "number",
      "description": "chunk index, for batched steps"
    },
    "output": {
      "description": "the step result (any JSON value)"
    }
  },
  "required": [
    "run",
    "step",
    "output"
  ]
}
```

## pipe__save

Save the chain of a run as a reusable recipe. Run it later with pipe__run {recipe, params}.

```json
{
  "type": "object",
  "properties": {
    "run": {
      "type": "string"
    },
    "name": {
      "type": "string",
      "description": "letters, digits, \"-\" or \"_\""
    },
    "description": {
      "type": "string"
    },
    "overwrite": {
      "type": "boolean"
    }
  },
  "required": [
    "run",
    "name"
  ]
}
```

## pipe__recipes

List saved recipes with their descriptions and params.

```json
{
  "type": "object",
  "properties": {}
}
```

