import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DownstreamPool } from '../src/downstream.js';
import { createProxy } from '../src/proxy.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Store } from '../src/store/store.js';
import type { PipeConfig } from '../src/types.js';
import { fixtureServer } from './helpers.js';

export async function startHarness(
  servers: PipeConfig['mcpServers'] = { echo: fixtureServer('echo-server') },
  extra: Omit<PipeConfig, 'mcpServers'> = {},
  opts: { store?: Store; pool?: DownstreamPool } = {},
) {
  const config: PipeConfig = { mcpServers: servers, ...extra };
  const pool = opts.pool ?? (await DownstreamPool.start(config));
  const store = opts.store ?? new MemoryStore();
  const proxy = createProxy(pool, store, { session: 'test', config });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await proxy.connect(a);
  const client = new Client({ name: 'host', version: '0' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as any;
  const close = async () => { await client.close(); await proxy.close(); if (!opts.pool) await pool.close(); };
  return { pool, store, proxy, client, call, close, config };
}

export const texts = (r: any): string[] => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text);
/** Handle id from the marker block at the end of a result. */
export const handleOf = (r: any): string => /⟨pipe:(c\d+)⟩/.exec(texts(r).join('\n'))![1]!;
/** Parsed JSON of the first text block. */
export const body = (r: any): any => JSON.parse(texts(r)[0]!);
