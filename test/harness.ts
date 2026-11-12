import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DownstreamPool } from '../src/downstream.js';
import { createProxy } from '../src/proxy.js';
import { MemoryStore } from '../src/store/memory.js';
import type { PipeConfig } from '../src/types.js';
import { fixtureServer } from './helpers.js';

export async function startHarness(servers: PipeConfig['mcpServers'] = { echo: fixtureServer('echo-server') }) {
  const pool = await DownstreamPool.start({ mcpServers: servers });
  const store = new MemoryStore();
  const proxy = createProxy(pool, store, { session: 'test' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await proxy.connect(a);
  const client = new Client({ name: 'host', version: '0' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as any;
  const close = async () => { await client.close(); await proxy.close(); await pool.close(); };
  return { pool, store, proxy, client, call, close };
}

export const texts = (r: any): string[] => r.content.filter((c: any) => c.type === 'text').map((c: any) => c.text);
