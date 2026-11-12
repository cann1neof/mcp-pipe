import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Blind mode: what the AI may see of a server's (or one tool's) data. */
export type PipePolicy = {
  visibility?: 'visible' | 'hidden';
  shape?: 'full' | 'types' | 'none';
  errors?: 'class' | 'full';
  allowSinks?: string[];
  tools?: Record<string, Omit<PipePolicy, 'tools'>>;
};

export type ServerConfig = (
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { url: string; headers?: Record<string, string> }
) & { pipe?: PipePolicy };

export type PipeConfig = {
  mcpServers: Record<string, ServerConfig>;
  store?: { path?: string; ttlDays?: number; memoryOnly?: boolean };
  peek?: { maxBytes?: number };
  recipesDir?: string;
};

export type CallRecord = {
  id: string;
  session: string;
  server: string;
  tool: string;
  args: unknown;
  result?: CallToolResult;
  isError?: boolean;
  parent?: string;
  createdAt: number;
  /** Blind mode taint: servers whose hidden data this call's result carries. Empty/undefined = visible. */
  hiddenFrom?: string[];
};

export type { CallToolResult };
