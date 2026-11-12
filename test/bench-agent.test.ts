import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runAgent, type ToolProvider } from '../bench/agent.js';
import { BROKEN_SQL, CORRECT_SQL, expectedRows, succeeded } from '../bench/tasks/sql-fix.js';
import { seedDb } from '../src/demo/sqlite-server.js';

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
    const run = await runAgent({
      prompt: 'go', tools: stubTools, model: 'm',
      createMessage: async (p) => { seen.push(structuredClone(p)); return replies.shift() as unknown as Anthropic.Message; },
    });
    expect(run).toMatchObject({ inputTokens: 250, outputTokens: 50, cacheReadTokens: 10, turns: 2, finalText: 'done' });
    expect(run.toolCalls).toEqual([{ name: 'db__query', args: { sql: 'x' }, isError: false, text: '[]' }]);
    expect(seen[0]!.system).toContain('server says hi');
    expect(seen[1]!.messages).toHaveLength(3);
  });
});

describe('sql-fix task', () => {
  it('broken query fails, correct query gives expected rows', () => {
    expect(() => seedDb().prepare(BROKEN_SQL).all()).toThrow(/usr_id/);
    expect(expectedRows().length).toBe(5);
    expect(CORRECT_SQL.split('\n').length).toBeGreaterThanOrEqual(50);
  });
  it('succeeded() accepts the rows with or without a pipe marker', () => {
    const text = JSON.stringify(expectedRows());
    const base = { model: 'm', inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, turns: 1, finalText: '', stopReason: 'end_turn' };
    expect(succeeded({ ...base, toolCalls: [{ name: 'pipe__patch', args: {}, isError: false, text: `${text}\n⟨pipe:c2⟩` }] })).toBe(true);
    expect(succeeded({ ...base, toolCalls: [{ name: 'db__query', args: {}, isError: false, text: '[]' }] })).toBe(false);
  });
});
