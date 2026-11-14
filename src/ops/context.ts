import { marker } from '../core.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PipeCore } from '../core.js';
import type { CallToolResult } from '../types.js';

export type Op = {
  def: Tool;
  handle(args: Record<string, unknown>, core: PipeCore): Promise<CallToolResult>;
};

export { textResult as text } from '../core.js';

/** JSON reply plus the handle marker of the record it describes. */
export const json = (v: unknown, handle?: string, isError = false): CallToolResult => ({
  content: [
    { type: 'text', text: JSON.stringify(v, null, 2) },
    ...(handle ? [{ type: 'text' as const, text: marker(handle) }] : []),
  ],
  ...(isError ? { isError: true } : {}),
});
