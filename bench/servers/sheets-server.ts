// Demo-only spreadsheet MCP. State is written to $DEMO_OUT/sheets.json so the outcome can be inspected.
import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

type Sheet = { id: string; title: string; url: string; cells: Record<string, string | number> };
const out = process.env.DEMO_OUT ? path.join(process.env.DEMO_OUT, 'sheets.json') : undefined;
const sheets: Record<string, Sheet> = out && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
const save = () => { if (out) fs.writeFileSync(out, JSON.stringify(sheets, null, 2)); };
const txt = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const err = (t: string) => ({ isError: true, content: [{ type: 'text' as const, text: t }] });

const col = (n: number) => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const parseCell = (a1: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(a1.toUpperCase());
  if (!m) return undefined;
  const c = [...m[1]!].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { c, r: Number(m[2]) - 1 };
};

const server = new McpServer({ name: 'sheets', version: '0.0.1' });
server.registerTool('create_spreadsheet', {
  description: 'Create a new, empty spreadsheet. Returns its id and URL.',
  inputSchema: { title: z.string() },
}, async ({ title }) => {
  const id = `sh${Object.keys(sheets).length + 1}`;
  sheets[id] = { id, title, url: `https://sheets.example.com/${id}`, cells: {} };
  save();
  return txt(JSON.stringify({ spreadsheet_id: id, url: sheets[id].url }));
});
server.registerTool('update_values', {
  description: 'Write a 2-D array of values into a spreadsheet, starting at the given top-left cell (A1 notation).',
  inputSchema: {
    spreadsheet_id: z.string(),
    start_cell: z.string().describe('e.g. "A1"'),
    values: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).describe('rows of cell values'),
  },
}, async ({ spreadsheet_id, start_cell, values }) => {
  const s = sheets[spreadsheet_id];
  if (!s) return err(`Error: no spreadsheet ${spreadsheet_id}`);
  const at = parseCell(start_cell);
  if (!at) return err(`Error: bad cell "${start_cell}"`);
  let n = 0;
  values.forEach((row, i) => row.forEach((v, j) => { if (v !== null) { s.cells[`${col(at.c + j)}${at.r + i + 1}`] = v; n++; } }));
  save();
  return txt(JSON.stringify({ updated_cells: n }));
});
server.registerTool('get_values', {
  description: 'Read all non-empty cells of a spreadsheet.',
  inputSchema: { spreadsheet_id: z.string() },
  annotations: { readOnlyHint: true },
}, async ({ spreadsheet_id }) => {
  const s = sheets[spreadsheet_id];
  return s ? txt(JSON.stringify(s.cells)) : err(`Error: no spreadsheet ${spreadsheet_id}`);
});
await server.connect(new StdioServerTransport());
