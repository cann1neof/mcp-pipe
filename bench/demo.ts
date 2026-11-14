// One real run: one prompt, three MCP servers behind mcp-pipe, every tool call logged in full.
// Usage: npm run demo [-- "custom prompt"]   (ANTHROPIC_API_KEY from .env; model: BENCH_MODEL)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpTools, runAgent } from './agent.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

// DEMO_SKILL=<dir under bench/skills, or a path to a SKILL.md>: the prompt carries that skill's text, the way a harness loads a skill.
// DEMO_NO_INSTRUCTIONS=1: the server's MCP instructions are not passed (some hosts drop them).
const skillName = process.env.DEMO_SKILL;
const skill = skillName ? fs.readFileSync((skillName.includes('/') ? path.resolve(root, skillName) : path.join(root, 'bench', 'skills', skillName, 'SKILL.md')), 'utf8') : undefined;
const BASE = process.argv[2] ??
  'count the retention rates in the last quarter using table `users_data`, put the results into a new spreadsheet and post a short summary with the link to #analytics';

const PROMPT = skill ? `${BASE}\n\n<skill name="${skillName}">\n${skill}</skill>` : BASE;

const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const srv = (f: string) => ({ command: tsx, args: [path.join(root, 'bench', 'servers', f)], env: { DEMO_OUT: outDir } });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(root, 'bench', 'results', `demo-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-demo-'));
const cfg = path.join(cfgDir, 'servers.json');
fs.writeFileSync(cfg, JSON.stringify({
  mcpServers: { db: srv('warehouse-server.ts'), sheets: srv('sheets-server.ts'), chat: srv('chat-server.ts') },
  store: { memoryOnly: true },
}));

const lines: string[] = [];
const log = (l: string) => { console.log(l); lines.push(l); };
const model = process.env.BENCH_MODEL ?? 'claude-opus-5-5';
log(`prompt: ${PROMPT}`);
log(`model: ${model}`);
log(`server instructions: ${process.env.DEMO_NO_INSTRUCTIONS === '1' ? 'off' : 'on'}`);

const tools = await mcpTools({ command: tsx, args: [path.join(root, 'src', 'cli.ts'), '--config', cfg] });
try {
  const run = await runAgent({ prompt: PROMPT, tools, model, maxTurns: 25, log, clip: 0, useInstructions: process.env.DEMO_NO_INSTRUCTIONS !== '1' });
  log(`\n== done: ${run.turns} turns, ${run.toolCalls.length} tool calls, in=${run.inputTokens + run.cacheReadTokens + run.cacheWriteTokens} out=${run.outputTokens}${run.error ? `, error: ${run.error}` : ''}`);
  for (const f of ['sheets.json', 'chat.json']) {
    const p = path.join(outDir, f);
    log(`\n== ${f}\n${fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '(nothing written)'}`);
  }
  const { conversation, ...rest } = run;
  fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify({ prompt: PROMPT, ...rest }, null, 2));
  fs.writeFileSync(path.join(outDir, 'conversation.json'), JSON.stringify({ model, ...conversation }, null, 2));
} finally {
  await tools.close();
  fs.writeFileSync(path.join(outDir, 'transcript.txt'), lines.join('\n') + '\n');
  console.log(`\n→ ${path.relative(root, outDir)}`);
}
