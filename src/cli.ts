#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { defaultConfigPath, defaultDir, loadConfig } from './config.js';
import { DownstreamPool } from './downstream.js';
import { createProxy } from './proxy.js';
import { MemoryStore } from './store/memory.js';
import { SqliteStore } from './store/sqlite.js';
import type { Store } from './store/store.js';
import { HOSTS, applyImport, describePlan, hostConfigPath, planImport, type Host } from './import/hosts.js';
import type { ServerConfig } from './types.js';
import { VERSION } from './version.js';
import { runDemoDbServer } from './demo/sqlite-server.js';

const USAGE = `mcp-pipe ${VERSION}

Usage:
  mcp-pipe [--config <servers.json>]          run the proxy over stdio (default ~/.mcp-pipe/servers.json)
  mcp-pipe import <${HOSTS.join('|')}> [--dry-run] [--overwrite] [--host-config <file>] [--config <servers.json>]
                                              move a host's MCP servers behind mcp-pipe
  mcp-pipe demo-db                            run a demo SQLite MCP server (for trying mcp-pipe out)
`;

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
  return v;
}

/** How a host should launch this mcp-pipe: via npx when installed from npm, else node + this checkout's cli.js. */
function selfEntry(configFile: string): ServerConfig {
  const self = fileURLToPath(import.meta.url);
  if (self.includes(`${path.sep}_npx${path.sep}`) || self.includes(`${path.sep}node_modules${path.sep}mcp-pipe${path.sep}`)) {
    return { command: 'npx', args: ['-y', 'mcp-pipe', '--config', configFile] };
  }
  const cli = self.endsWith('.ts') ? self.replace(/src[\\/]cli\.ts$/, path.join('dist', 'cli.js')) : self;
  return { command: process.execPath, args: [cli, '--config', configFile] };
}

async function runImport(argv: string[]): Promise<void> {
  const host = argv[1] as Host;
  if (!HOSTS.includes(host)) throw new Error(`import: host must be one of ${HOSTS.join(', ')}`);
  const pipeConfigFile = path.resolve(flag(argv, '--config') ?? defaultConfigPath());
  const plan = planImport({
    hostFile: path.resolve(flag(argv, '--host-config') ?? hostConfigPath(host)),
    pipeConfigFile,
    pipeEntry: selfEntry(pipeConfigFile),
    overwrite: argv.includes('--overwrite'),
  });
  const dry = argv.includes('--dry-run');
  console.log(describePlan(plan, dry));
  if (dry) return;
  const { backup } = applyImport(plan);
  console.log(`  backup: ${backup}`);
  console.log(`done. Restart ${host} to load mcp-pipe.`);
  if (host === 'claude-code') console.log('note: only user-scope servers in ~/.claude.json are moved; project .mcp.json files are untouched.');
}

async function runProxy(argv: string[]): Promise<void> {
  const cfg = loadConfig(path.resolve(flag(argv, '--config') ?? defaultConfigPath()));
  const store: Store = cfg.store?.memoryOnly
    ? new MemoryStore()
    : new SqliteStore(cfg.store?.path ?? path.join(defaultDir(), 'store.db'), { ttlDays: cfg.store?.ttlDays });
  const pool = await DownstreamPool.start(cfg);
  for (const [name, err] of Object.entries(pool.errors())) console.error(`mcp-pipe: server "${name}" failed: ${err}`);
  const server = createProxy(pool, store, { session: randomUUID() });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => {});
    await pool.close();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);
  await server.connect(new StdioServerTransport());
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) return void console.log(USAGE);
  if (argv.includes('--version')) return void console.log(VERSION);
  if (argv[0] === 'import') return runImport(argv);
  if (argv[0] === 'demo-db') return runDemoDbServer();
  if (argv[0] && !argv[0].startsWith('--')) throw new Error(`unknown command "${argv[0]}"\n\n${USAGE}`);
  return runProxy(argv);
}

main().catch((e: Error) => {
  console.error(`mcp-pipe: ${e.message}`);
  process.exit(1);
});
