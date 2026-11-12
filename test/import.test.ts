import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { planImport, applyImport, isPipeEntry } from '../src/import/hosts.js';
import { tsxBin, root } from './helpers.js';

const pipeEntry = { command: 'npx', args: ['-y', 'mcp-pipe', '--config', '/abs/servers.json'] };

function setup(host: object, existing?: object) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-imp-'));
  const hostFile = path.join(dir, 'host.json');
  const pipeConfigFile = path.join(dir, 'pipe', 'servers.json');
  fs.writeFileSync(hostFile, JSON.stringify(host));
  if (existing) {
    fs.mkdirSync(path.dirname(pipeConfigFile));
    fs.writeFileSync(pipeConfigFile, JSON.stringify(existing));
  }
  return { dir, hostFile, pipeConfigFile };
}
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('import', () => {
  it('moves entries into servers.json and leaves only mcp-pipe', () => {
    const f = setup({ other: 1, mcpServers: { pg: { command: 'pg-mcp' }, fs: { command: 'fs-mcp', args: ['/'] } } });
    applyImport(planImport({ ...f, pipeEntry }));
    expect(read(f.hostFile)).toEqual({ other: 1, mcpServers: { 'mcp-pipe': pipeEntry } });
    expect(read(f.pipeConfigFile).mcpServers).toEqual({ pg: { command: 'pg-mcp' }, fs: { command: 'fs-mcp', args: ['/'] } });
    expect(fs.statSync(f.pipeConfigFile).mode & 0o777).toBe(0o600);
  });
  it('writes a backup', () => {
    const f = setup({ mcpServers: { pg: { command: 'x' } } });
    const { backup } = applyImport(planImport({ ...f, pipeEntry }));
    expect(path.basename(backup)).toMatch(/^host\.json\.bak-/);
    expect(read(backup)).toEqual({ mcpServers: { pg: { command: 'x' } } });
  });
  it('merges with existing servers.json; clash wins only with overwrite', () => {
    const host = { mcpServers: { pg: { command: 'new' }, b: { command: 'b' } } };
    const existing = { store: { ttlDays: 3 }, mcpServers: { pg: { command: 'old' }, a: { command: 'a' } } };
    const f = setup(host, existing);
    const p = planImport({ ...f, pipeEntry });
    expect(p.skipped.map((s) => s.name)).toEqual(['pg']);
    applyImport(p);
    const out = read(f.pipeConfigFile);
    expect(out.store).toEqual({ ttlDays: 3 });
    expect(out.mcpServers).toEqual({ pg: { command: 'old' }, a: { command: 'a' }, b: { command: 'b' } });
    const g = setup(host, existing);
    applyImport(planImport({ ...g, pipeEntry, overwrite: true }));
    expect(read(g.pipeConfigFile).mcpServers.pg).toEqual({ command: 'new' });
  });
  it('existing mcp-pipe entry is not moved', () => {
    const f = setup({ mcpServers: { 'mcp-pipe': { command: 'old' }, x: { command: 'npx', args: ['-y', 'mcp-pipe'] }, pg: { command: 'p' } } });
    const p = planImport({ ...f, pipeEntry });
    expect(p.moved).toEqual(['pg']);
  });
  it('isPipeEntry recognises launchers', () => {
    expect(isPipeEntry('x', { command: 'node', args: ['/a/mcp-pipe/dist/cli.js'] })).toBe(true);
    expect(isPipeEntry('x', { command: 'npx', args: ['-y', 'mcp-pipe@0.1.0'] })).toBe(true);
    expect(isPipeEntry('x', { command: 'npx', args: ['-y', 'mcp-pipe-other'] })).toBe(false);
  });
  it('--dry-run writes nothing and prints the plan', () => {
    const f = setup({ mcpServers: { pg: { command: 'x' } } });
    const before = fs.readFileSync(f.hostFile, 'utf8');
    const out = execFileSync(tsxBin, [path.join(root, 'src/cli.ts'), 'import', 'cursor', '--dry-run',
      '--host-config', f.hostFile, '--config', f.pipeConfigFile], { encoding: 'utf8' });
    expect(out).toMatch(/\[dry run\]/);
    expect(out).toMatch(/move to .*: pg/);
    expect(fs.readFileSync(f.hostFile, 'utf8')).toBe(before);
    expect(fs.existsSync(f.pipeConfigFile)).toBe(false);
    expect(fs.readdirSync(f.dir).filter((n) => n.includes('.bak-'))).toEqual([]);
  });
});
