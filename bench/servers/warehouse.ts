// Benchmark-only analytics warehouse: one events table `users_data` behind two generic tools.
// The planted bug: the metadata catalog documents the user column as `usr_id`, but the real column is `user_id`
// (a stale data catalog — common in real warehouses). Data is deterministic (seeded PRNG).
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const DATA_END = '2026-11-11'; // last day with data

function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Catalog entry as the metadata service reports it — including the stale column name. */
export const CATALOG: Record<string, { description: string; columns: { name: string; type: string; description: string }[] }> = {
  users_data: {
    description: 'Product analytics events. One row per user event.',
    columns: [
      { name: 'event_id', type: 'INTEGER', description: 'Unique identifier of the event.' },
      { name: 'usr_id', type: 'INTEGER', description: 'Identifier of the user who performed the event.' },
      { name: 'signup_date', type: 'TEXT', description: 'Date the user created their account (YYYY-MM-DD).' },
      { name: 'event_time', type: 'TEXT', description: 'UTC timestamp of the event (ISO 8601).' },
      { name: 'event_name', type: 'TEXT', description: 'Event type: login, page_view, purchase.' },
      { name: 'country', type: 'TEXT', description: 'ISO 3166-1 alpha-2 country code of the user.' },
      { name: 'plan', type: 'TEXT', description: 'Subscription plan at the time of the event: free, pro, team.' },
    ],
  },
};

export function createWarehouse(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users_data (
    event_id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, signup_date TEXT NOT NULL,
    event_time TEXT NOT NULL, event_name TEXT NOT NULL, country TEXT NOT NULL, plan TEXT NOT NULL)`);
  const rnd = prng(42);
  const countries = ['US', 'DE', 'IL', 'GB', 'FR', 'IN', 'BR', 'JP'];
  const events = ['login', 'page_view', 'page_view', 'page_view', 'purchase'];
  const start = Date.parse('2025-10-01T00:00:00Z');
  const end = Date.parse(`${DATA_END}T23:59:59Z`);
  const ins = db.prepare('INSERT INTO users_data (user_id, signup_date, event_time, event_name, country, plan) VALUES (?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (let u = 1; u <= 1500; u++) {
      const signup = start + Math.floor(rnd() * (end - start - 7 * DAY));
      const country = countries[Math.floor(rnd() * countries.length)]!;
      let plan = rnd() < 0.75 ? 'free' : rnd() < 0.8 ? 'pro' : 'team';
      const stickiness = 0.4 + rnd() * 0.5; // per-user chance of being active in a given week
      const churn = 0.03 + rnd() * 0.12;     // per-user weekly chance of leaving for good
      for (let week = 0, t = signup; t < end; week++, t += 7 * DAY) {
        if (week > 0 && rnd() < churn) break;
        if (week > 0 && rnd() > stickiness) continue;
        if (plan === 'free' && rnd() < 0.01) plan = 'pro';
        const n = 1 + Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) {
          const at = t + Math.floor(rnd() * 7 * DAY);
          if (at > end) continue;
          ins.run(u, iso(signup), new Date(at).toISOString().slice(0, 19) + 'Z', events[Math.floor(rnd() * events.length)]!, country, plan);
        }
      }
    }
  })();
  return db;
}

const MAX_ROWS = 1000;

export function registerWarehouse(server: McpServer, db = createWarehouse()): void {
  server.registerTool('run_query', {
    description: 'Execute a SQL query against the analytics database and return the result rows as JSON.',
    inputSchema: { sql: z.string().describe('SQL query (SQLite dialect)') },
    annotations: { readOnlyHint: true },
  }, async ({ sql }) => {
    try {
      const stmt = db.prepare(sql);
      if (!stmt.reader) return { isError: true, content: [{ type: 'text' as const, text: 'Error: only read queries are allowed' }] };
      const rows = stmt.all();
      const shown = rows.slice(0, MAX_ROWS);
      const note = rows.length > MAX_ROWS ? `\n(${rows.length} rows, first ${MAX_ROWS} shown)` : '';
      return { content: [{ type: 'text' as const, text: JSON.stringify(shown) + note }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] };
    }
  });

  server.registerTool('get_table_description', {
    description: 'Return metadata for a table: its description and each column\'s name, type and description.',
    inputSchema: { table: z.string().describe('table name') },
    annotations: { readOnlyHint: true },
  }, async ({ table }) => {
    const entry = CATALOG[table];
    if (!entry) {
      return { isError: true, content: [{ type: 'text' as const, text: `Error: unknown table "${table}". Available: ${Object.keys(CATALOG).join(', ')}` }] };
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify({ table, ...entry }) }] };
  });
}
