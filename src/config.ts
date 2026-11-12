import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PipeConfig } from './types.js';

const stdio = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
}).passthrough();
const http = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
}).passthrough();

const configSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()),
  store: z.object({
    path: z.string().optional(),
    ttlDays: z.number().positive().optional(),
    memoryOnly: z.boolean().optional(),
  }).optional(),
  peek: z.object({ maxBytes: z.number().int().positive().optional() }).optional(),
  recipesDir: z.string().optional(),
});

export const defaultDir = () => path.join(os.homedir(), '.mcp-pipe');
export const defaultConfigPath = () => path.join(defaultDir(), 'servers.json');

/** Replaces `${env:VAR}` in every string of `v`. Missing variables are an error naming the variable. */
export function expandEnv(v: unknown, env: NodeJS.ProcessEnv = process.env, where = ''): unknown {
  if (typeof v === 'string') {
    return v.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
      const val = env[name];
      if (val === undefined) throw new Error(`${where || 'config'}: environment variable ${name} is not set`);
      return val;
    });
  }
  if (Array.isArray(v)) return v.map((x) => expandEnv(x, env, where));
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandEnv(x, env, where)]));
  }
  return v;
}

export function parseConfig(raw: unknown, source = 'config'): PipeConfig {
  const top = configSchema.safeParse(raw);
  if (!top.success) {
    const issue = top.error.issues[0]!;
    throw new Error(`${source}: invalid "${issue.path.join('.') || '(root)'}": ${issue.message}`);
  }
  const servers: PipeConfig['mcpServers'] = {};
  for (const [name, entry] of Object.entries(top.data.mcpServers)) {
    const e = entry as Record<string, unknown> | null;
    const schema = e && typeof e === 'object' && 'url' in e && !('command' in e) ? http : stdio;
    if (!e || typeof e !== 'object' || (!('command' in e) && !('url' in e))) {
      throw new Error(`${source}: server "${name}" needs "command" or "url"`);
    }
    const r = schema.safeParse(e);
    if (!r.success) {
      const issue = r.error.issues[0]!;
      throw new Error(`${source}: server "${name}" invalid "${issue.path.join('.')}": ${issue.message}`);
    }
    servers[name] = expandEnv(r.data, process.env, `${source}: server "${name}"`) as PipeConfig['mcpServers'][string];
  }
  return { ...top.data, mcpServers: servers };
}

export function loadConfig(p: string): PipeConfig {
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    throw new Error(`config not found: ${p} (run "mcp-pipe import <host>" or create it)`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`${p}: invalid JSON: ${(e as Error).message}`);
  }
  return parseConfig(raw, p);
}
