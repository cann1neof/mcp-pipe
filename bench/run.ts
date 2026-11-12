// Usage: npm run bench -- sql-fix [--runs 10] [--mode direct|pipe|both]
// Credentials: ANTHROPIC_API_KEY (read from .env if present). Model: BENCH_MODEL (default claude-opus-5-5).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpTools, runAgent, type AgentRun } from './agent.js';
import * as sqlFix from './tasks/sql-fix.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const TASKS = { 'sql-fix': sqlFix } as const;
type Mode = 'direct' | 'pipe';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const cli = path.join(root, 'src', 'cli.ts');
const demoDb = { command: tsx, args: [cli, 'demo-db'] };

function serverFor(mode: Mode) {
  if (mode === 'direct') return demoDb;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-bench-'));
  const cfg = path.join(dir, 'servers.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { db: demoDb }, store: { memoryOnly: true } }));
  return { command: tsx, args: [cli, '--config', cfg] };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

async function main() {
  const taskName = (process.argv[2] ?? 'sql-fix') as keyof typeof TASKS;
  const task = TASKS[taskName];
  if (!task) throw new Error(`unknown task ${taskName}; tasks: ${Object.keys(TASKS).join(', ')}`);
  const runs = Number(arg('--runs', '10'));
  const modeArg = arg('--mode', 'both');
  const modes: Mode[] = modeArg === 'both' ? ['direct', 'pipe'] : [modeArg as Mode];
  const model = process.env.BENCH_MODEL ?? 'claude-opus-5-5';
  const effort = process.env.BENCH_EFFORT as 'low' | 'medium' | 'high' | undefined;
  const summary: Record<string, unknown> = {};

  for (const mode of modes) {
    const results: (AgentRun & { success: boolean })[] = [];
    for (let i = 0; i < runs; i++) {
      const tools = await mcpTools(serverFor(mode));
      try {
        const r = await runAgent({ prompt: task.PROMPT, system: task.SYSTEM, tools, model, effort });
        results.push({ ...r, success: task.succeeded(r) });
      } finally {
        await tools.close();
      }
      const last = results.at(-1)!;
      console.log(`${taskName} ${mode} #${i + 1}: out=${last.outputTokens} in=${last.inputTokens + last.cacheReadTokens + last.cacheWriteTokens} ` +
        `turns=${last.turns} tools=[${last.toolCalls.map((c) => c.name).join(', ')}] ${last.success ? 'OK' : 'FAIL'}`);
    }
    const s = {
      model, effort: effort ?? 'default', runs,
      successRate: mean(results.map((r) => (r.success ? 1 : 0))),
      avgOutputTokens: mean(results.map((r) => r.outputTokens)),
      avgInputTokens: mean(results.map((r) => r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)),
      avgTurns: mean(results.map((r) => r.turns)),
      patchUsed: results.filter((r) => r.toolCalls.some((c) => c.name === 'pipe__patch')).length,
    };
    summary[mode] = s;
    const out = path.join(root, 'bench', 'results', `${taskName}-${mode}.json`);
    fs.writeFileSync(out, JSON.stringify({ task: taskName, mode, date: new Date().toISOString(), summary: s, results }, null, 2));
    console.log(`→ ${path.relative(root, out)}`);
  }

  const d = summary.direct as { avgOutputTokens: number; avgInputTokens: number } | undefined;
  const p = summary.pipe as { avgOutputTokens: number; avgInputTokens: number; patchUsed: number } | undefined;
  if (d && p) {
    const pct = (a: number, b: number) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : 'n/a');
    console.log(`\noutput tokens: pipe ${p.avgOutputTokens.toFixed(0)} vs direct ${d.avgOutputTokens.toFixed(0)} (${pct(p.avgOutputTokens, d.avgOutputTokens)})`);
    console.log(`total tokens:  pipe ${(p.avgOutputTokens + p.avgInputTokens).toFixed(0)} vs direct ${(d.avgOutputTokens + d.avgInputTokens).toFixed(0)} (${pct(p.avgOutputTokens + p.avgInputTokens, d.avgOutputTokens + d.avgInputTokens)})`);
    console.log(`patch used: ${p.patchUsed}/${runs}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
