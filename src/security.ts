// Optional (config confirmWrites): bulk operations that write are shown as a plan and need a one-time confirm token.
import { createHash, randomBytes } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/** A tool counts as writing unless it declares readOnlyHint: true. Unknown tools count as writing. */
export function isWrite(def: Tool | undefined): boolean {
  return def?.annotations?.readOnlyHint !== true;
}

export type PlanStep = { step?: string; tool: string; count: number; writes: boolean; sampleArgs?: unknown };

const TTL_MS = 10 * 60_000;
const hash = (plan: unknown) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

export class ConfirmTokens {
  private tokens = new Map<string, { hash: string; expires: number }>();

  issue(plan: unknown, now = Date.now()): string {
    for (const [t, v] of this.tokens) if (v.expires < now) this.tokens.delete(t);
    const token = `ok-${randomBytes(6).toString('hex')}`;
    this.tokens.set(token, { hash: hash(plan), expires: now + TTL_MS });
    return token;
  }

  /** Consumes the token. Throws with the reason if it is unknown, expired, used, or issued for another plan. */
  consume(token: string, plan: unknown, now = Date.now()): void {
    const t = this.tokens.get(token);
    if (!t) throw new Error(`confirm token "${token}" is unknown or already used; ask again without confirm to get a new plan`);
    this.tokens.delete(token);
    if (t.expires < now) throw new Error('confirm token expired; ask again without confirm to get a new plan');
    if (t.hash !== hash(plan)) throw new Error('the plan changed since the confirm token was issued; review the new plan');
  }
}

export type NeedsConfirm = { status: 'needs_confirm'; plan: PlanStep[]; confirm: string; note: string };

/**
 * Gate for bulk work. Read-only plans pass. Write plans need `confirm` (a token from an earlier needs_confirm reply).
 * Returns a needs_confirm payload to send back, or undefined if the work may run.
 */
export function gate(tokens: ConfirmTokens, plan: PlanStep[], confirm: string | undefined, enabled = true): NeedsConfirm | undefined {
  if (!enabled || !plan.some((s) => s.writes)) return undefined;
  if (confirm) {
    tokens.consume(confirm, plan);
    return undefined;
  }
  return {
    status: 'needs_confirm',
    plan,
    confirm: tokens.issue(plan),
    note: 'This runs tools that can change data. Show the plan to the user; to proceed, repeat the same call with "confirm" set to this token.',
  };
}
