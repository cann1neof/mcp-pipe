import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerConfig } from '../types.js';

export const HOSTS = ['claude-desktop', 'claude-code', 'cursor'] as const;
export type Host = (typeof HOSTS)[number];

export function hostConfigPath(host: Host, home = os.homedir()): string {
  switch (host) {
    case 'claude-desktop':
      if (process.platform === 'win32') return path.join(process.env.APPDATA ?? home, 'Claude', 'claude_desktop_config.json');
      if (process.platform === 'linux') return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
      return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'claude-code':
      return path.join(home, '.claude.json');
    case 'cursor':
      return path.join(home, '.cursor', 'mcp.json');
  }
}

/** An entry is "ours" if it is named mcp-pipe or launches mcp-pipe. */
export function isPipeEntry(name: string, e: unknown): boolean {
  if (name === 'mcp-pipe') return true;
  const cfg = e as { command?: string; args?: string[] };
  return [cfg?.command ?? '', ...(cfg?.args ?? [])].some((s) => typeof s === 'string' && /(^|[\\/@])mcp-pipe(@[^/\\]*)?($|[\\/])|mcp-pipe[\\/]dist[\\/]cli\.js$/.test(s));
}

export type ImportPlan = {
  hostFile: string;
  pipeConfigFile: string;
  moved: string[];
  skipped: { name: string; reason: string }[];
  newPipeServers: Record<string, unknown>;
  newHost: Record<string, unknown>;
};

export function planImport(opts: {
  hostFile: string;
  pipeConfigFile: string;
  pipeEntry: ServerConfig;
  overwrite?: boolean;
}): ImportPlan {
  if (!fs.existsSync(opts.hostFile)) throw new Error(`host config not found: ${opts.hostFile}`);
  const host = JSON.parse(fs.readFileSync(opts.hostFile, 'utf8')) as Record<string, unknown>;
  const hostServers = (host.mcpServers ?? {}) as Record<string, unknown>;
  const existing = fs.existsSync(opts.pipeConfigFile)
    ? (JSON.parse(fs.readFileSync(opts.pipeConfigFile, 'utf8')) as Record<string, unknown>)
    : { mcpServers: {} };
  const pipeServers = { ...((existing.mcpServers ?? {}) as Record<string, unknown>) };

  const moved: string[] = [];
  const skipped: ImportPlan['skipped'] = [];
  const keepInHost: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(hostServers)) {
    if (isPipeEntry(name, entry)) continue; // replaced by the fresh entry below
    if (name === 'pipe') {
      skipped.push({ name, reason: '"pipe" is reserved by mcp-pipe; rename it in the host config first' });
      keepInHost[name] = entry;
      continue;
    }
    if (name in pipeServers && !opts.overwrite && JSON.stringify(pipeServers[name]) !== JSON.stringify(entry)) {
      skipped.push({ name, reason: 'already in servers.json with different settings (use --overwrite)' });
      continue;
    }
    pipeServers[name] = entry;
    moved.push(name);
  }
  return {
    hostFile: opts.hostFile,
    pipeConfigFile: opts.pipeConfigFile,
    moved,
    skipped,
    newPipeServers: { ...existing, mcpServers: pipeServers },
    newHost: { ...host, mcpServers: { ...keepInHost, 'mcp-pipe': opts.pipeEntry } },
  };
}

export function applyImport(plan: ImportPlan, now = new Date()): { backup: string } {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backup = `${plan.hostFile}.bak-${stamp}`;
  fs.copyFileSync(plan.hostFile, backup);
  fs.mkdirSync(path.dirname(plan.pipeConfigFile), { recursive: true, mode: 0o700 });
  // servers.json can hold secrets (env values) → 0600.
  fs.writeFileSync(plan.pipeConfigFile, JSON.stringify(plan.newPipeServers, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(plan.pipeConfigFile, 0o600);
  fs.writeFileSync(plan.hostFile, JSON.stringify(plan.newHost, null, 2) + '\n');
  return { backup };
}

export function describePlan(plan: ImportPlan, dryRun: boolean): string {
  const lines = [
    `${dryRun ? '[dry run] ' : ''}import from ${plan.hostFile}`,
    plan.moved.length ? `  move to ${plan.pipeConfigFile}: ${plan.moved.join(', ')}` : '  nothing to move',
    ...plan.skipped.map((s) => `  skip ${s.name}: ${s.reason}`),
    `  host entry becomes: "mcp-pipe": ${JSON.stringify((plan.newHost.mcpServers as Record<string, unknown>)['mcp-pipe'])}`,
  ];
  return lines.join('\n');
}
