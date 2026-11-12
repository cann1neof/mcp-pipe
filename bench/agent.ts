// Minimal tool-use agent loop for the benchmark. Not shipped: the proxy itself never calls a model.
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

export type ToolResult = { text: string; isError: boolean };

/** Where the agent's tools come from: an MCP server in real runs, a stub in unit tests. */
export interface ToolProvider {
  tools(): Promise<Anthropic.Tool[]>;
  instructions(): string | undefined;
  call(name: string, args: unknown): Promise<ToolResult>;
  close(): Promise<void>;
}

export type CreateMessage = (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export type AgentRun = {
  model: string;
  inputTokens: number;       // uncached input
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  turns: number;
  toolCalls: { name: string; args: unknown; isError: boolean; text: string }[];
  finalText: string;
  stopReason: string | null;
  error?: string;
};

export async function mcpTools(server: { command: string; args?: string[]; env?: Record<string, string> }): Promise<ToolProvider> {
  const client = new Client({ name: 'bench', version: '0' });
  await client.connect(new StdioClientTransport({
    command: server.command, args: server.args ?? [],
    env: { ...getDefaultEnvironment(), ...(server.env ?? {}) }, stderr: 'ignore',
  }));
  return {
    async tools() {
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));
    },
    instructions: () => client.getInstructions(),
    async call(name, args) {
      const r = (await client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> })) as {
        content: { type: string; text?: string }[]; isError?: boolean;
      };
      return {
        text: r.content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n'),
        isError: r.isError === true,
      };
    },
    close: () => client.close(),
  };
}

export async function runAgent(opts: {
  prompt: string;
  system?: string;
  tools: ToolProvider;
  model: string;
  maxTurns?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  createMessage?: CreateMessage;
  /** Called with human-readable lines as the run progresses (for --verbose). */
  log?: (line: string) => void;
}): Promise<AgentRun> {
  const log = opts.log ?? (() => {});
  const create: CreateMessage = opts.createMessage ?? ((p) => new Anthropic().messages.create(p));
  const tools = await opts.tools.tools();
  const system = [opts.system, opts.tools.instructions()].filter(Boolean).join('\n\n') || undefined;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.prompt }];
  log(`  system: ${system ?? '(none)'}`);
  log(`  tools: ${tools.map((t) => t.name).join(', ')}`);
  const run: AgentRun = {
    model: opts.model, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
    turns: 0, toolCalls: [], finalText: '', stopReason: null,
  };

  for (let turn = 0; turn < (opts.maxTurns ?? 12); turn++) {
    const res = await create({
      model: opts.model,
      max_tokens: 16000,
      ...(system ? { system } : {}),
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      tools,
      messages,
    });
    run.turns++;
    run.inputTokens += res.usage.input_tokens;
    run.cacheReadTokens += res.usage.cache_read_input_tokens ?? 0;
    run.cacheWriteTokens += res.usage.cache_creation_input_tokens ?? 0;
    run.outputTokens += res.usage.output_tokens;
    run.stopReason = res.stop_reason;
    log(`  ── turn ${run.turns}: in=${res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0)} out=${res.usage.output_tokens} stop=${res.stop_reason}`);
    for (const b of res.content) {
      if (b.type === 'text' && b.text.trim()) log(`  AI: ${b.text.trim()}`);
      if (b.type === 'tool_use') log(`  → ${b.name} ${clip(JSON.stringify(b.input), 600)}`);
    }
    // Append the full content (thinking blocks included) so the next turn is valid.
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      run.finalText = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
      return run;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      let r: ToolResult;
      try {
        r = await opts.tools.call(block.name, block.input);
      } catch (e) {
        r = { text: `tool call failed: ${(e as Error).message}`, isError: true };
      }
      log(`  ← ${r.isError ? 'ERROR ' : ''}${clip(r.text, 300)}`);
      run.toolCalls.push({ name: block.name, args: block.input, isError: r.isError, text: r.text });
      results.push({ type: 'tool_result', tool_use_id: block.id, content: r.text, is_error: r.isError });
    }
    messages.push({ role: 'user', content: results });
  }
  run.error = 'max turns reached';
  return run;
}

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}… (${flat.length} chars)` : flat;
}
