import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { url: string; headers?: Record<string, string> };

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
};

export type { CallToolResult };
