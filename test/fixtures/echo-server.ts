// Tiny deterministic MCP server used by tests.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo', version: '0.0.1' });

server.registerTool('echo', { description: 'Echo text back', inputSchema: { text: z.string() } },
  async ({ text }) => ({ content: [{ type: 'text', text }] }));

server.registerTool('fail', { description: 'Always fails', inputSchema: {} },
  async () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] }));

server.registerTool('json', { description: 'Return value as JSON text', inputSchema: { value: z.any() } },
  async ({ value }) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] }));

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
server.registerTool('image', { description: 'Return a 1px PNG', inputSchema: {} },
  async () => ({ content: [{ type: 'image', data: PNG_1PX, mimeType: 'image/png' }] }));

server.registerTool('slow', { description: 'Wait ms then reply', inputSchema: { ms: z.number() } },
  async ({ ms }) => {
    await new Promise((r) => setTimeout(r, ms));
    return { content: [{ type: 'text', text: `waited ${ms}` }] };
  });

await server.connect(new StdioServerTransport());
