import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { CallRecord, CallToolResult } from '../types.js';
import type { NewCall, NewRun, RunRecord, Store } from './store.js';

type Row = {
  n: number; session: string; server: string; tool: string; args: string;
  result: string | null; is_error: number | null; parent: string | null; created_at: number; hidden_from: string | null;
};
type RunRow = { n: number; session: string; data: string; created_at: number };

const DAY = 86_400_000;

export class SqliteStore implements Store {
  private db: Database.Database;
  private ins: Database.Statement;
  private fin: Database.Statement;
  private sel: Database.Statement;
  private insRun: Database.Statement;
  private selRun: Database.Statement;
  private updRun: Database.Statement;

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
      created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
      n INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);`);
    const cols = (this.db.prepare('PRAGMA table_info(calls)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('hidden_from')) this.db.exec('ALTER TABLE calls ADD COLUMN hidden_from TEXT');
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.chmodSync(file + suffix, 0o600);
    }
    this.purge(Date.now() - (opts.ttlDays ?? 7) * DAY);
    this.ins = this.db.prepare(
      'INSERT INTO calls (session, server, tool, args, parent, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    this.fin = this.db.prepare('UPDATE calls SET result = ?, is_error = ?, hidden_from = ? WHERE n = ?');
    this.sel = this.db.prepare('SELECT * FROM calls WHERE n = ?');
    this.insRun = this.db.prepare('INSERT INTO runs (session, data, created_at) VALUES (?, ?, ?)');
    this.selRun = this.db.prepare('SELECT * FROM runs WHERE n = ?');
    this.updRun = this.db.prepare('UPDATE runs SET data = ? WHERE n = ?');
  }

  putCall(c: NewCall): CallRecord {
    const createdAt = Date.now();
    const info = this.ins.run(c.session, c.server, c.tool, JSON.stringify(c.args ?? null), c.parent ?? null, createdAt);
    return { ...structuredClone(c), id: `c${info.lastInsertRowid}`, createdAt };
  }

  finishCall(id: string, result: CallToolResult, isError: boolean, hiddenFrom?: string[]): void {
    const hf = hiddenFrom?.length ? JSON.stringify(hiddenFrom) : null;
    const info = this.fin.run(JSON.stringify(result), isError ? 1 : 0, hf, num(id, 'c'));
    if (info.changes === 0) throw new Error(`unknown handle ${id}`);
  }

  getCall(id: string): CallRecord | undefined {
    const n = num(id, 'c');
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
    if (row.hidden_from !== null) rec.hiddenFrom = JSON.parse(row.hidden_from) as string[];
    return rec;
  }

  putRun(r: NewRun): RunRecord {
    const createdAt = Date.now();
    const info = this.insRun.run(r.session, JSON.stringify(r), createdAt);
    return { ...structuredClone(r), id: `r${info.lastInsertRowid}`, createdAt };
  }

  getRun(id: string): RunRecord | undefined {
    const n = num(id, 'r');
    if (n === undefined) return undefined;
    const row = this.selRun.get(n) as RunRow | undefined;
    if (!row) return undefined;
    return { ...(JSON.parse(row.data) as NewRun), id, createdAt: row.created_at };
  }

  updateRun(r: RunRecord): void {
    const { id: _id, createdAt: _c, ...data } = r;
    const info = this.updRun.run(JSON.stringify(data), num(r.id, 'r'));
    if (info.changes === 0) throw new Error(`unknown run ${r.id}`);
  }

  purge(before: number): number {
    const a = this.db.prepare('DELETE FROM calls WHERE created_at < ?').run(before).changes;
    const b = this.db.prepare('DELETE FROM runs WHERE created_at < ?').run(before).changes;
    return a + b;
  }

  close(): void { this.db.close(); }
}

function num(id: string, prefix: 'c' | 'r'): number | undefined {
  const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
  return m ? Number(m[1]) : undefined;
}
