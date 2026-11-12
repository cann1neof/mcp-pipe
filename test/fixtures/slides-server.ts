// Fake slides MCP: one in-memory deck of text boxes.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const decks: Record<string, { slide: number; box: string; text: string }[]> = {
  d1: Array.from({ length: 45 }, (_, i) => ({ slide: Math.floor(i / 3) + 1, box: `b${(i % 3) + 1}`, text: `text ${i + 1}` })),
};
let writes = 0;
const txt = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

const server = new McpServer({ name: 'slides', version: '0' });
server.registerTool('list_text', { description: 'All text boxes of a deck', inputSchema: { deck: z.string() }, annotations: { readOnlyHint: true } },
  async ({ deck }) => txt(JSON.stringify(decks[deck] ?? [])));
server.registerTool('set_text', {
  description: 'Set the text of one box', inputSchema: { deck: z.string(), slide: z.number(), box: z.string(), text: z.string() },
}, async ({ deck, slide, box, text }) => {
  const b = decks[deck]?.find((x) => x.slide === slide && x.box === box);
  if (!b) return { isError: true, content: [{ type: 'text', text: `no box ${box} on slide ${slide}` }] };
  b.text = text;
  writes++;
  return txt('ok');
});
server.registerTool('writes', { description: 'Number of set_text calls', inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => txt(String(writes)));
await server.connect(new StdioServerTransport());
