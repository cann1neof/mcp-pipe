// Demo-only team chat MCP. Posted messages are written to $DEMO_OUT/chat.json.
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const out = process.env.DEMO_OUT ? path.join(process.env.DEMO_OUT, 'chat.json') : undefined;
const channels = ['general', 'analytics', 'product', 'random'];
const posts: { channel: string; text: string; ts: string }[] = [];
const txt = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

const server = new McpServer({ name: 'chat', version: '0.0.1' });
server.registerTool('list_channels', {
  description: 'List the channels in the workspace.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => txt(JSON.stringify(channels)));
server.registerTool('post_message', {
  description: 'Post a message to a channel. Supports Markdown.',
  inputSchema: { channel: z.string().describe('channel name without #'), text: z.string() },
}, async ({ channel, text }) => {
  const name = channel.replace(/^#/, '');
  if (!channels.includes(name)) return { isError: true, content: [{ type: 'text' as const, text: `Error: no channel "${channel}"` }] };
  const ts = new Date().toISOString();
  posts.push({ channel: name, text, ts });
  if (out) fs.writeFileSync(out, JSON.stringify(posts, null, 2));
  return txt(JSON.stringify({ ok: true, channel: name, ts }));
});
await server.connect(new StdioServerTransport());
