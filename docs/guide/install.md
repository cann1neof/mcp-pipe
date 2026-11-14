# Install

Requires Node.js 22 or newer.

## Move your existing servers behind mcp-pipe

```bash
npx -y mcp-pipe import claude-desktop --dry-run   # shows what would move
npx -y mcp-pipe import claude-desktop
```

Hosts: `claude-desktop`, `claude-code` (user-scope servers in `~/.claude.json`), `cursor`.

`import`:

1. copies every server entry from the host config into `~/.mcp-pipe/servers.json` (same `mcpServers` shape, file mode 600);
2. replaces them in the host config with one entry that starts mcp-pipe;
3. writes a backup of the host config next to it (`<file>.bak-<timestamp>`).

Restart the host. Your tools now appear as `<server>__<tool>` (e.g. `postgres__query`), plus the `pipe__*` tools.

Undo: copy the `.bak-…` file back over the host config.

## Install the usage skill

The MCP server only exposes tools; the skill tells the AI how to use them: pass results by reference instead of copying them, compute in SQL or jq, patch failed calls, and write multi-step work as one pipe.

```bash
npx -y mcp-pipe install-skill                 # ~/.claude/skills/mcp-pipe/SKILL.md (Claude Code)
npx -y mcp-pipe install-skill --dir <skills dir>  # other harnesses
```

## Add it by hand

`~/.mcp-pipe/servers.json` uses the same shape as Claude Desktop's config:

```json
{
  "mcpServers": {
    "db": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "${env:DATABASE_URL}"] },
    "sheets": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${keychain:sheets/token}" } }
  }
}
```

Host config entry:

```json
"mcp-pipe": { "command": "npx", "args": ["-y", "mcp-pipe"] }
```

Claude Code: `claude mcp add mcp-pipe -- npx -y mcp-pipe`

## Try it without your own servers

`mcp-pipe demo-db` is a small SQLite shop database (`users`, `orders`) exposed as an MCP server:

```json
{ "mcpServers": { "db": { "command": "npx", "args": ["-y", "mcp-pipe", "demo-db"] } } }
```

Ask the AI to *"count orders per country, joining users and orders on u.usr_id"*. The query fails (the column is `user_id`); the AI can fix it with `pipe__patch` instead of sending the query again.

## Serve over HTTP

```bash
npx -y mcp-pipe --http 8787          # http://127.0.0.1:8787/mcp, one session per client
npx -y mcp-pipe --http 8787 --host 0.0.0.0
```

Bound to loopback by default, with DNS-rebinding protection. There is no authentication on the HTTP endpoint: expose it beyond localhost only behind your own auth.

## Check what is connected

Ask the AI to call `pipe__get` with handle `status`: it lists connected servers and any startup errors. A server that fails to start never blocks the others.
