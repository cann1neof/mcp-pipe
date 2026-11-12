// Prints the exact system prompt and tool definitions the model gets in each bench mode.
// Usage: npx tsx bench/show.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpTools } from './agent.js';
import * as task from './tasks/retention.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const cli = path.join(root, 'src', 'cli.ts');
const demoDb = { command: tsx, args: [path.join(root, 'bench', 'servers', task.SERVER)] };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-show-'));
const cfg = path.join(dir, 'servers.json');
fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { db: demoDb }, store: { memoryOnly: true } }));

const modes: [string, { command: string; args: string[] }][] = [
  ['direct', demoDb],
  ['pipe', { command: tsx, args: [cli, '--config', cfg] }],
];
for (const [mode, server] of modes) {
  const p = await mcpTools(server);
  const system = [task.SYSTEM, p.instructions()].filter(Boolean).join('\n\n');
  console.log(`\n===== ${mode} =====\n--- system ---\n${system}\n--- tools ---`);
  console.log(JSON.stringify(await p.tools(), null, 2));
  await p.close();
}
console.log(`\n===== user prompt (both modes) =====\n${task.PROMPT}`);
