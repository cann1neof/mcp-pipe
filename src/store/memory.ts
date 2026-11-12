import type { CallRecord, CallToolResult } from '../types.js';
import type { NewCall, Store } from './store.js';

export class MemoryStore implements Store {
  private n = 0;
  private calls = new Map<string, CallRecord>();

  putCall(c: NewCall): CallRecord {
    const rec: CallRecord = { ...structuredClone(c), id: `c${++this.n}`, createdAt: Date.now() };
    this.calls.set(rec.id, rec);
    return structuredClone(rec);
  }
  finishCall(id: string, result: CallToolResult, isError: boolean): void {
    const rec = this.calls.get(id);
    if (!rec) throw new Error(`unknown handle ${id}`);
    rec.result = structuredClone(result);
    rec.isError = isError;
  }
  getCall(id: string): CallRecord | undefined {
    const rec = this.calls.get(id);
    return rec ? structuredClone(rec) : undefined;
  }
  close(): void {}
}
