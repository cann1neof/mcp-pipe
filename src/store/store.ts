import type { CallRecord, CallToolResult } from '../types.js';

export type NewCall = Omit<CallRecord, 'id' | 'createdAt'>;

export interface Store {
  /** Records a call before it runs. id = "c" + counter, unique per store. */
  putCall(c: NewCall): CallRecord;
  finishCall(id: string, result: CallToolResult, isError: boolean): void;
  getCall(id: string): CallRecord | undefined;
  close(): void;
}
