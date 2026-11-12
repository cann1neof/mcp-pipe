// Tiny deterministic MCP server used by tests (stdio).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerEcho } from './echo-tools.js';

const server = new McpServer({ name: 'echo', version: '0.0.1' });
registerEcho(server);
await server.connect(new StdioServerTransport());
