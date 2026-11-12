import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { CallRecord, CallToolResult } from '../types.js';
import type { NewCall, Store } from './store.js';

type Row = {
  n: number; session: string; server: string; tool: string; args: string;
  result: string | null; is_error: number | null; parent: string | null; created_at: number;
};

const DAY = 86_400_000;

export class SqliteStore implements Store {
  private db: Database.Database;
  private ins: Database.Statement;
  private fin: Database.Statement;
  private sel: Database.Statement;

  constructor(file: string, opts: { ttlDays?: number } = {}) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // Create the file with 0600 before SQLite opens it, so it is never world-readable.
    fs.closeSync(fs.openSync(file, 'a', 0o600));
    fs.chmodSync(file, 0o600);
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS calls (
      n INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL, server TEXT NOT NULL, tool TEXT NOT NULL,
      args TEXT NOT NULL, result TEXT, is_error INTEGER, parent TEXT,
      created_at INTEGER NOT NULL)`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.chmodSync(file + suffix, 0o600);
    }
    const ttl = opts.ttlDays ?? 7;
    this.db.prepare('DELETE FROM calls WHERE created_at < ?').run(Date.now() - ttl * DAY);
    this.ins = this.db.prepare(
      'INSERT INTO calls (session, server, tool, args, parent, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    this.fin = this.db.prepare('UPDATE calls SET result = ?, is_error = ? WHERE n = ?');
    this.sel = this.db.prepare('SELECT * FROM calls WHERE n = ?');
  }

  putCall(c: NewCall): CallRecord {
    const createdAt = Date.now();
    const info = this.ins.run(c.session, c.server, c.tool, JSON.stringify(c.args ?? null), c.parent ?? null, createdAt);
    return { ...structuredClone(c), id: `c${info.lastInsertRowid}`, createdAt };
  }

  finishCall(id: string, result: CallToolResult, isError: boolean): void {
    const info = this.fin.run(JSON.stringify(result), isError ? 1 : 0, num(id));
    if (info.changes === 0) throw new Error(`unknown handle ${id}`);
  }

  getCall(id: string): CallRecord | undefined {
    const n = num(id);
    if (n === undefined) return undefined;
    const row = this.sel.get(n) as Row | undefined;
    if (!row) return undefined;
    const rec: CallRecord = {
      id, session: row.session, server: row.server, tool: row.tool,
      args: JSON.parse(row.args), createdAt: row.created_at,
    };
    if (row.result !== null) rec.result = JSON.parse(row.result) as CallToolResult;
    if (row.is_error !== null) rec.isError = row.is_error === 1;
    if (row.parent !== null) rec.parent = row.parent;
    return rec;
  }

  close(): void { this.db.close(); }
}

function num(id: string): number | undefined {
  const m = /^c(\d+)$/.exec(id);
  return m ? Number(m[1]) : undefined;
}
