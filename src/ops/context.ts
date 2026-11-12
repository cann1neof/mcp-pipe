import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DownstreamPool } from '../downstream.js';
import type { Store } from '../store/store.js';
import type { CallRecord, CallToolResult } from '../types.js';

export type OpContext = {
  pool: DownstreamPool;
  store: Store;
  session: string;
  /** Records + executes a downstream call, returns the stored record and the result with the handle marker. */
  execute(rec: CallRecord): Promise<CallToolResult>;
};

export type Op = {
  def: Tool;
  handle(args: Record<string, unknown>, ctx: OpContext): Promise<CallToolResult>;
};

export const text = (t: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: t }],
  ...(isError ? { isError: true } : {}),
});
