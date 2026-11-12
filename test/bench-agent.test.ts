import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgent, type ToolProvider } from '../bench/agent.js';
import { PROMPT, SYSTEM, succeeded, hitPlantedBug } from '../bench/tasks/retention.js';
import { createWarehouse, CATALOG } from '../bench/servers/warehouse.js';

const usage = (i: number, o: number) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 }) as Anthropic.Usage;

const stubTools: ToolProvider = {
  tools: async () => [{ name: 'db__query', description: '', input_schema: { type: 'object' } }],
  instructions: () => 'server says hi',
  call: async () => ({ text: '[]', isError: false }),
  close: async () => {},
};

describe('bench agent', () => {
  it('sums usage across turns and records tool calls', async () => {
    const replies = [
      { stop_reason: 'tool_use', usage: usage(100, 40), content: [{ type: 'tool_use', id: 't1', name: 'db__query', input: { sql: 'x' } }] },
      { stop_reason: 'end_turn', usage: usage(150, 10), content: [{ type: 'text', text: 'done' }] },
    ];
    const seen: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const lines: string[] = [];
    const run = await runAgent({
      prompt: 'go', tools: stubTools, model: 'm', log: (l) => lines.push(l),
      createMessage: async (p) => { seen.push(structuredClone(p)); return replies.shift() as unknown as Anthropic.Message; },
    });
    expect(run).toMatchObject({ inputTokens: 250, outputTokens: 50, cacheReadTokens: 10, turns: 2, finalText: 'done' });
    expect(run.toolCalls).toEqual([{ name: 'db__query', args: { sql: 'x' }, isError: false, text: '[]' }]);
    expect(seen[0]!.system).toContain('server says hi');
    expect(seen[1]!.messages).toHaveLength(3);
    expect(lines.join('\n')).toMatch(/turn 1: in=105 out=40 stop=tool_use[\s\S]*→ db__query \{"sql":"x"\}[\s\S]*← \[\][\s\S]*AI: done/);
  });
});

describe('retention task + warehouse', () => {
  const db = createWarehouse();
  it('catalog documents usr_id but the table has user_id', () => {
    expect(CATALOG.users_data!.columns.map((c) => c.name)).toContain('usr_id');
    expect(() => db.prepare('SELECT COUNT(DISTINCT usr_id) FROM users_data').all()).toThrow(/usr_id/);
    const [row] = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM users_data').all() as { n: number }[];
    expect(row!.n).toBeGreaterThan(1000);
  });
  it('data is deterministic and reaches the last quarter', () => {
    const a = createWarehouse().prepare('SELECT COUNT(*) n, MAX(event_time) m FROM users_data').get();
    const b = createWarehouse().prepare('SELECT COUNT(*) n, MAX(event_time) m FROM users_data').get() as { m: string };
    expect(a).toEqual(b);
    expect(b.m.startsWith('2026-11')).toBe(true);
  });
  it('prompt is the bare request', () => {
    expect(PROMPT).toBe('count the retention rates in the last quarter using table `users_data`');
    expect(SYSTEM).toBeUndefined();
  });
  it('success needs a working users_data query and a number in the answer', () => {
    const base = { model: 'm', inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, turns: 3, stopReason: 'end_turn' };
    const bad = { name: 'run_query', args: { sql: 'SELECT usr_id FROM users_data' }, isError: true, text: 'Error: no such column: usr_id' };
    const good = { name: 'run_query', args: { sql: 'SELECT 1 FROM users_data' }, isError: false, text: '[{"retention":0.41}]' };
    const run = { ...base, toolCalls: [bad, good], finalText: 'Retention was 41.2%.' };
    expect(succeeded(run)).toBe(true);
    expect(hitPlantedBug(run)).toBe(true);
    expect(succeeded({ ...run, finalText: 'I could not compute it.' })).toBe(false);
  });
});
