// Demo MCP server: a seeded in-memory SQLite database with one `query` tool.
// Used by tests, the benchmark, and `mcp-pipe demo-db` for trying mcp-pipe out.
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const COUNTRIES = ['IL', 'DE', 'US', 'FR', 'JP'];
const NAMES = ['Ann', 'Ben', 'Chen', 'Dana', 'Eli', 'Fay', 'Gil', 'Hana', 'Ido', 'Jo'];

export function seedDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (user_id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL);
           CREATE TABLE orders (order_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(user_id),
                                total REAL NOT NULL, created_at TEXT NOT NULL);`);
  const iu = db.prepare('INSERT INTO users VALUES (?, ?, ?)');
  const io = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?)');
  for (let i = 1; i <= 50; i++) iu.run(i, `${NAMES[i % 10]} ${i}`, COUNTRIES[i % 5]);
  for (let i = 1; i <= 500; i++) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    io.run(i, (i * 7) % 50 + 1, Math.round(((i * 37) % 1000) + 9.99) / 1, `2026-${month}-${day}`);
  }
  return db;
}

export async function runDemoDbServer(): Promise<void> {
  const db = seedDb();
  const server = new McpServer({ name: 'demo-db', version: '0.0.1' });
  server.registerTool('query', {
    description: 'Run a read-only SQL query on the demo shop database. Tables: users(user_id, name, country), orders(order_id, user_id, total, created_at). Returns rows as JSON.',
    inputSchema: { sql: z.string() },
    annotations: { readOnlyHint: true },
  }, async ({ sql }) => {
    try {
      const rows = db.prepare(sql).all();
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: `SQL error: ${(e as Error).message}` }] };
    }
  });
  await server.connect(new StdioServerTransport());
}
