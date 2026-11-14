import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import type { PipeConfig } from './types.js';

const policyBase = z.object({
  visibility: z.enum(['visible', 'hidden']).optional(),
  shape: z.enum(['full', 'types', 'none']).optional(),
  errors: z.enum(['class', 'full']).optional(),
  allowSinks: z.array(z.string()).optional(),
}).strict();
const policy = policyBase.extend({ tools: z.record(z.string(), policyBase).optional() }).strict();

const stdio = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  pipe: policy.optional(),
}).passthrough();
const http = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  pipe: policy.optional(),
}).passthrough();

const configSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()),
  store: z.object({
    path: z.string().optional(),
    ttlDays: z.number().positive().optional(),
    memoryOnly: z.boolean().optional(),
  }).optional(),
  peek: z.object({ maxBytes: z.number().int().min(0).optional() }).optional(),
  confirmWrites: z.boolean().optional(),
});

export const defaultDir = () => path.join(os.homedir(), '.mcp-pipe');
export const defaultConfigPath = () => path.join(defaultDir(), 'servers.json');

export type SecretSources = {
  env?: NodeJS.ProcessEnv;
  keychain?: (service: string, account: string) => string;
};

/** macOS keychain lookup via `security find-generic-password`. */
export function macKeychain(service: string, account: string): string {
  if (process.platform !== 'darwin') throw new Error('${keychain:…} secrets are macOS-only; use ${env:VAR} on this system');
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-a', account, '-w'], { encoding: 'utf8' }).replace(/\n$/, '');
  } catch {
    throw new Error(`keychain item not found (service "${service}", account "${account}")`);
  }
}

/** Replaces `${env:VAR}` and `${keychain:service/account}` in every string of `v`. Missing secrets are errors. */
export function expandSecrets(v: unknown, src: SecretSources = {}, where = 'config'): unknown {
  const env = src.env ?? process.env;
  const keychain = src.keychain ?? macKeychain;
  if (typeof v === 'string') {
    return v
      .replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name: string) => {
        const val = env[name];
        if (val === undefined) throw new Error(`${where}: environment variable ${name} is not set`);
        return val;
      })
      .replace(/\$\{keychain:([^/}]+)\/([^}]+)\}/g, (_m, service: string, account: string) => {
        try { return keychain(service, account); } catch (e) { throw new Error(`${where}: ${(e as Error).message}`); }
      });
  }
  if (Array.isArray(v)) return v.map((x) => expandSecrets(x, src, where));
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandSecrets(x, src, where)]));
  }
  return v;
}

/** @deprecated use expandSecrets */
export const expandEnv = (v: unknown, env: NodeJS.ProcessEnv = process.env, where = '') =>
  expandSecrets(v, { env }, where || 'config');

export function parseConfig(raw: unknown, source = 'config', secrets: SecretSources = {}): PipeConfig {
  const top = configSchema.safeParse(raw);
  if (!top.success) {
    const issue = top.error.issues[0]!;
    throw new Error(`${source}: invalid "${issue.path.join('.') || '(root)'}": ${issue.message}`);
  }
  const servers: PipeConfig['mcpServers'] = {};
  for (const [name, entry] of Object.entries(top.data.mcpServers)) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || (!('command' in e) && !('url' in e))) {
      throw new Error(`${source}: server "${name}" needs "command" or "url"`);
    }
    const schema = 'url' in e && !('command' in e) ? http : stdio;
    const r = schema.safeParse(e);
    if (!r.success) {
      const issue = r.error.issues[0]!;
      throw new Error(`${source}: server "${name}" invalid "${issue.path.join('.')}": ${issue.message}`);
    }
    const { pipe, ...conn } = r.data as Record<string, unknown>;
    const expanded = expandSecrets(conn, secrets, `${source}: server "${name}"`) as Record<string, unknown>;
    servers[name] = { ...expanded, ...(pipe ? { pipe } : {}) } as PipeConfig['mcpServers'][string];
  }
  const { store, ...rest } = top.data;
  return {
    ...rest,
    mcpServers: servers,
    ...(store ? { store: { ...store, ...(store.path ? { path: expandHome(store.path) } : {}) } } : {}),
  };
}

/** `~/x` → `<home>/x`. */
export function expandHome(p: string): string {
  return p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

export function loadConfig(p: string, secrets: SecretSources = {}): PipeConfig {
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
  return parseConfig(raw, p, secrets);
}
