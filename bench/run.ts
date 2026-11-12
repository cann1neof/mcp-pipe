// Usage: npm run bench -- retention [--runs 10] [--mode direct|pipe|both] [--verbose]
// Credentials: ANTHROPIC_API_KEY (read from .env if present). Model: BENCH_MODEL (default claude-opus-5-5).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpTools, runAgent, type AgentRun } from './agent.js';
import * as retention from './tasks/retention.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const TASKS = { retention } as const;
type Mode = 'direct' | 'pipe';

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : dflt;
}

const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
const cli = path.join(root, 'src', 'cli.ts');
function serverFor(mode: Mode, task: (typeof TASKS)[keyof typeof TASKS]) {
  const db = { command: tsx, args: [path.join(root, 'bench', 'servers', task.SERVER)] };
  if (mode === 'direct') return db;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-bench-'));
  const cfg = path.join(dir, 'servers.json');
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { db }, store: { memoryOnly: true } }));
  return { command: tsx, args: [cli, '--config', cfg] };
}

// $ per 1M tokens [input, output]; cache reads 0.1x input, cache writes 1.25x input.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5], 'claude-fable-5-2': [8, 40],
};
const cost = (r: AgentRun) => {
  const p = PRICES[r.model];
  if (!p) return NaN;
  return (r.inputTokens * p[0] + r.cacheReadTokens * p[0] * 0.1 + r.cacheWriteTokens * p[0] * 1.25 + r.outputTokens * p[1]) / 1e6;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

async function main() {
  const taskName = (process.argv[2] ?? 'retention') as keyof typeof TASKS;
  const task = TASKS[taskName];
  if (!task) throw new Error(`unknown task ${taskName}; tasks: ${Object.keys(TASKS).join(', ')}`);
  const runs = Number(arg('--runs', '10'));
  const modeArg = arg('--mode', 'both');
  const modes: Mode[] = modeArg === 'both' ? ['direct', 'pipe'] : [modeArg as Mode];
  const model = process.env.BENCH_MODEL ?? 'claude-opus-5-5';
  const effort = process.env.BENCH_EFFORT as 'low' | 'medium' | 'high' | undefined;
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const summary: Record<string, unknown> = {};

  for (const mode of modes) {
    const results: (AgentRun & { success: boolean })[] = [];
    for (let i = 0; i < runs; i++) {
      if (verbose) console.log(`\n${taskName} ${mode} #${i + 1}`);
      const tools = await mcpTools(serverFor(mode, task));
      try {
        const r = await runAgent({
          prompt: task.PROMPT, system: task.SYSTEM, tools, model, effort,
          ...(verbose ? { log: (l: string) => console.log(l) } : {}),
        });
        results.push({ ...r, success: task.succeeded(r) });
      } finally {
        await tools.close();
      }
      const last = results.at(-1)!;
      console.log(`${taskName} ${mode} #${i + 1}: out=${last.outputTokens} in=${last.inputTokens + last.cacheReadTokens + last.cacheWriteTokens} ` +
        `turns=${last.turns} tools=[${last.toolCalls.map((c) => c.name).join(', ')}] bug=${task.hitPlantedBug(last) ? 'hit' : 'missed'} ${last.success ? 'OK' : 'FAIL'}`);
    }
    const s = {
      model, effort: effort ?? 'default', runs,
      successRate: mean(results.map((r) => (r.success ? 1 : 0))),
      avgOutputTokens: mean(results.map((r) => r.outputTokens)),
      avgInputTokens: mean(results.map((r) => r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)),
      avgTurns: mean(results.map((r) => r.turns)),
      avgCostUSD: mean(results.map(cost)),
      hitPlantedBug: results.filter((r) => task.hitPlantedBug(r)).length,
      describeUsed: results.filter((r) => r.toolCalls.some((c) => /get_table_description/.test(c.name))).length,
      patchUsed: results.filter((r) => r.toolCalls.some((c) => c.name === 'pipe__patch')).length,
    };
    summary[mode] = s;
    const out = path.join(root, 'bench', 'results', `${taskName}-${mode}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ task: taskName, mode, date: new Date().toISOString(), summary: s, results }, null, 2));
    console.log(`→ ${path.relative(root, out)}`);
  }

  type S = { avgOutputTokens: number; avgInputTokens: number; avgCostUSD: number; patchUsed: number; hitPlantedBug: number; successRate: number };
  const d = summary.direct as S | undefined;
  const p = summary.pipe as S | undefined;
  if (d && p) {
    const pct = (a: number, b: number) => (b ? `${(((a - b) / b) * 100).toFixed(1)}%` : 'n/a');
    console.log(`\noutput tokens: pipe ${p.avgOutputTokens.toFixed(0)} vs direct ${d.avgOutputTokens.toFixed(0)} (${pct(p.avgOutputTokens, d.avgOutputTokens)})`);
    console.log(`total tokens:  pipe ${(p.avgOutputTokens + p.avgInputTokens).toFixed(0)} vs direct ${(d.avgOutputTokens + d.avgInputTokens).toFixed(0)} (${pct(p.avgOutputTokens + p.avgInputTokens, d.avgOutputTokens + d.avgInputTokens)})`);
    console.log(`cost:          pipe $${p.avgCostUSD.toFixed(4)} vs direct $${d.avgCostUSD.toFixed(4)} (${pct(p.avgCostUSD, d.avgCostUSD)})`);
    console.log(`hit planted bug: direct ${d.hitPlantedBug}/${runs}, pipe ${p.hitPlantedBug}/${runs} · success: direct ${d.successRate * runs}/${runs}, pipe ${p.successRate * runs}/${runs}`);
    console.log(`patch used: ${p.patchUsed}/${runs}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
