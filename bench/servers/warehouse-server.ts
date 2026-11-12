import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerWarehouse } from './warehouse.js';

const server = new McpServer({ name: 'warehouse', version: '0.0.1' });
registerWarehouse(server);
await server.connect(new StdioServerTransport());
