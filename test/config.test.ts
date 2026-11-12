import { describe, it, expect } from 'vitest';
import { parseConfig } from '../src/config.js';

describe('parseConfig', () => {
  it('accepts stdio and http entries', () => {
    const c = parseConfig({ mcpServers: { a: { command: 'x', args: ['1'] }, b: { url: 'https://e.com/mcp' } } });
    expect(Object.keys(c.mcpServers)).toEqual(['a', 'b']);
  });
  it('rejects entry with neither command nor url, naming the server', () => {
    expect(() => parseConfig({ mcpServers: { broken: { args: [] } } })).toThrow(/broken/);
  });
  it('rejects missing mcpServers', () => {
    expect(() => parseConfig({})).toThrow(/mcpServers/);
  });
});
