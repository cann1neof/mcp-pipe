// Blind mode: per-server/per-tool visibility of data to the AI.
import type { PipeConfig, PipePolicy } from './types.js';

export type ResolvedPolicy = {
  visibility: 'visible' | 'hidden';
  shape: 'full' | 'types' | 'none';
  errors: 'class' | 'full';
  allowSinks?: string[];
};

const DEFAULTS: ResolvedPolicy = { visibility: 'visible', shape: 'full', errors: 'full' };
const HIDDEN_DEFAULTS: ResolvedPolicy = { visibility: 'hidden', shape: 'full', errors: 'class' };

/** Policy for one tool: server policy, then the per-tool override. Hidden servers default to class-only errors. */
export function policyFor(cfg: PipeConfig, server: string, tool?: string): ResolvedPolicy {
  const entry = cfg.mcpServers[server] as { pipe?: PipePolicy } | undefined;
  const sp = entry?.pipe ?? {};
  const tp = (tool && sp.tools?.[tool]) || {};
  const visibility = tp.visibility ?? sp.visibility ?? 'visible';
  const base = visibility === 'hidden' ? HIDDEN_DEFAULTS : DEFAULTS;
  const allowSinks = tp.allowSinks ?? sp.allowSinks;
  return {
    visibility,
    shape: tp.shape ?? sp.shape ?? base.shape,
    errors: tp.errors ?? sp.errors ?? base.errors,
    ...(allowSinks ? { allowSinks } : {}),
  };
}

const SHAPE_RANK = { full: 0, types: 1, none: 2 } as const;

/** The strictest combination of several sources' policies (for values derived from more than one hidden server). */
export function strictest(ps: ResolvedPolicy[]): ResolvedPolicy {
  if (ps.length === 0) return DEFAULTS;
  return ps.reduce((a, b) => ({
    visibility: a.visibility === 'hidden' || b.visibility === 'hidden' ? 'hidden' : 'visible',
    shape: SHAPE_RANK[a.shape] >= SHAPE_RANK[b.shape] ? a.shape : b.shape,
    errors: a.errors === 'class' || b.errors === 'class' ? 'class' : 'full',
  }));
}

/** Keeps the kind of an error but drops values: first line only, quoted strings → '***', digits → #. */
export function maskError(text: string): string {
  const first = text.split('\n').find((l) => l.trim()) ?? 'error';
  return first
    .replace(/'[^']*'/g, "'***'")
    .replace(/"[^"]*"/g, '"***"')
    .replace(/`[^`]*`/g, '`***`')
    .replace(/\d+(\.\d+)?/g, '#');
}
