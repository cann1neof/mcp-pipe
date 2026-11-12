import type { CallRecord, CallToolResult } from '../types.js';
import type { NewCall, NewRun, RunRecord, Store } from './store.js';

export class MemoryStore implements Store {
  private n = 0;
  private r = 0;
  private calls = new Map<string, CallRecord>();
  private runs = new Map<string, RunRecord>();

  putCall(c: NewCall): CallRecord {
    const rec: CallRecord = { ...structuredClone(c), id: `c${++this.n}`, createdAt: Date.now() };
    this.calls.set(rec.id, rec);
    return structuredClone(rec);
  }
  finishCall(id: string, result: CallToolResult, isError: boolean, hiddenFrom?: string[]): void {
    const rec = this.calls.get(id);
    if (!rec) throw new Error(`unknown handle ${id}`);
    rec.result = structuredClone(result);
    rec.isError = isError;
    if (hiddenFrom?.length) rec.hiddenFrom = [...hiddenFrom];
  }
  getCall(id: string): CallRecord | undefined {
    const rec = this.calls.get(id);
    return rec ? structuredClone(rec) : undefined;
  }
  putRun(r: NewRun): RunRecord {
    const rec: RunRecord = { ...structuredClone(r), id: `r${++this.r}`, createdAt: Date.now() };
    this.runs.set(rec.id, rec);
    return structuredClone(rec);
  }
  getRun(id: string): RunRecord | undefined {
    const r = this.runs.get(id);
    return r ? structuredClone(r) : undefined;
  }
  updateRun(r: RunRecord): void {
    if (!this.runs.has(r.id)) throw new Error(`unknown run ${r.id}`);
    this.runs.set(r.id, structuredClone(r));
  }
  purge(before: number): number {
    let n = 0;
    for (const [k, v] of this.calls) if (v.createdAt < before) { this.calls.delete(k); n++; }
    for (const [k, v] of this.runs) if (v.createdAt < before) { this.runs.delete(k); n++; }
    return n;
  }
  close(): void {}
}
