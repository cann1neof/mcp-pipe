// Realistic task: a bare analyst request. The catalog says `usr_id`; the table has `user_id`.
import type { AgentRun } from '../agent.js';

export const SERVER = 'warehouse-server.ts';
export const PROMPT = 'count the retention rates in the last quarter using table `users_data`';
export const SYSTEM: string | undefined = undefined;

/** Recovered = after the stale-metadata error, a query on users_data succeeded and the model gave an answer. */
export function succeeded(run: AgentRun): boolean {
  const ok = run.toolCalls.some((c) => !c.isError && /run_query|pipe__patch/.test(c.name) &&
    /users_data/i.test(JSON.stringify(c.args) + c.text) && !/^Error/.test(c.text));
  const answered = /\d+(\.\d+)?\s*%|0\.\d+/.test(run.finalText);
  return ok && answered && !run.error;
}

export function hitPlantedBug(run: AgentRun): boolean {
  return run.toolCalls.some((c) => c.isError && /usr_id/.test(c.text));
}
