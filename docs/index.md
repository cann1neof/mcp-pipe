---
layout: home
hero:
  name: mcp-pipe
  text: Copy/paste for AI tool calls
  tagline: A self-hosted MCP proxy. Every tool call gets a handle, so the AI moves data by reference, fixes calls by patch, and runs whole plans in one request — instead of re-typing data it already has.
  actions:
    - theme: brand
      text: Install
      link: /guide/install
    - theme: alt
      text: pipe__* reference
      link: /reference/ops
features:
  - title: Any host, any MCP server
    details: Claude Desktop, Claude Code, Cursor or your own agent. mcp-pipe sits between the host and your servers; nothing in the host changes.
  - title: Patch instead of rewrite
    details: A 60-line query with one wrong column is fixed with one find/replace edit and re-run — the AI does not send the query again.
  - title: Refs between tools
    details: '"{{ c3.out.rows | map(.id) }}" in any argument. Query rows go straight into a spreadsheet; the AI never copies them.'
  - title: Plans and recipes
    details: The AI writes a chain of steps once (calls, jq, per-item calls, pauses for judgement) and runs it in one request. Working plans are saved as recipes.
  - title: AI steps without the data
    details: Steps that need judgement pause the run. A subagent can read the input and resume it, so the main conversation never holds the data.
  - title: Blind mode
    details: Mark a server hidden and its data flows through plans to allowed destinations without ever reaching the AI.
---
