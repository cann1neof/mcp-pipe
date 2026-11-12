import type { CallRecord, CallToolResult } from '../types.js';
import type { Chain } from '../chain/schema.js';

export type NewCall = Omit<CallRecord, 'id' | 'createdAt'>;

export type StepState = {
  status: 'pending' | 'done' | 'failed' | 'paused';
  /** Call record holding the step's output. */
  callId?: string;
  error?: string;
  /** ai steps split into chunks: input handle per chunk, and the output call id of each resumed chunk. */
  chunks?: { inputs: string[]; done: Record<number, string> };
  /** map steps: item index → call id of the finished item call (idempotent reruns skip these). */
  items?: Record<number, string>;
};

export type RunStatus = 'defined' | 'running' | 'paused' | 'failed' | 'done';

export type RunRecord = {
  id: string;
  session: string;
  chain: Chain;
  params: Record<string, unknown>;
  steps: Record<string, StepState>;
  status: RunStatus;
  /** The user confirmed this run's write steps; cleared when the chain is patched. */
  approved?: boolean;
  createdAt: number;
};

export type NewRun = Omit<RunRecord, 'id' | 'createdAt'>;

export interface Store {
  /** Records a call before it runs. id = "c" + counter, unique per store. */
  putCall(c: NewCall): CallRecord;
  finishCall(id: string, result: CallToolResult, isError: boolean, hiddenFrom?: string[]): void;
  getCall(id: string): CallRecord | undefined;
  /** id = "r" + counter. */
  putRun(r: NewRun): RunRecord;
  getRun(id: string): RunRecord | undefined;
  updateRun(r: RunRecord): void;
  /** Deletes calls and runs created before `before` (ms epoch). Returns how many rows went. */
  purge(before: number): number;
  close(): void;
}
