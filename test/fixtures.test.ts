import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixtureServer } from './helpers.js';

describe('echo fixture', () => {
  it('responds', async () => {
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StdioClientTransport(fixtureServer('echo-server')));
    const r = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
    expect((r.content as any)[0].text).toBe('hi');
    await client.close();
  });
});
