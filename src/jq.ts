// jq transforms, run in a worker thread so a runaway filter can be killed after a timeout.
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JQ_MAIN = require.resolve('jq-wasm'); // CommonJS build; the worker below is CommonJS (eval)

const WORKER_SRC = `
const { parentPort } = require('node:worker_threads');
const { loadJq } = require(${JSON.stringify(JQ_MAIN)});
const ready = loadJq();
parentPort.on('message', async ({ id, input, filter, flags }) => {
  try {
    const jq = await ready;
    parentPort.postMessage({ id, ok: true, out: jq.json(input, filter, flags) });
  } catch (e) {
    const msg = (e && (e.stderr || e.message)) || String(e);
    parentPort.postMessage({ id, ok: false, error: String(msg).trim() });
  }
});
`;

export const JQ_TIMEOUT_MS = 5000;
const VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class JqError extends Error {
  constructor(message: string, readonly kind: 'error' | 'timeout' = 'error') {
    super(message);
  }
}

type Pending = { resolve: (v: unknown[]) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class JqWorker {
  private worker?: Worker;
  private pending = new Map<number, Pending>();
  private next = 0;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(WORKER_SRC, { eval: true });
    w.unref();
    w.on('message', (m: { id: number; ok: boolean; out?: unknown[]; error?: string }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.ok) p.resolve(m.out ?? []);
      else p.reject(new JqError(m.error ?? 'jq failed'));
    });
    w.on('error', (e) => { if (this.worker === w) this.failAll(e); });
    w.on('exit', () => {
      if (this.worker !== w) return; // a worker we already replaced after a timeout
      this.worker = undefined;
      this.failAll(new Error('jq worker exited'));
    });
    this.worker = w;
    return w;
  }

  private failAll(e: Error) {
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(e); this.pending.delete(id); }
  }

  run(input: string, filter: string, flags: string[], timeoutMs: number): Promise<unknown[]> {
    const w = this.ensure();
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JqError(`jq filter timed out after ${timeoutMs / 1000}s`, 'timeout'));
        // The filter may never return: kill the worker; the next call starts a fresh one.
        const dead = this.worker;
        this.worker = undefined;
        void dead?.terminate();
        this.failAll(new JqError('jq worker restarted after a timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      w.postMessage({ id, input, filter, flags });
    });
  }
}

const shared = new JqWorker();

/**
 * Runs a jq filter on a value. `vars` become jq variables (`$name`).
 * One output → that value; no output → null; several outputs → an array of them.
 */
export async function transform(
  value: unknown,
  filter: string,
  vars: Record<string, unknown> = {},
  timeoutMs = JQ_TIMEOUT_MS,
): Promise<unknown> {
  const flags: string[] = [];
  for (const [name, v] of Object.entries(vars)) {
    if (!VAR_RE.test(name)) continue; // not addressable from jq; skip silently
    flags.push('--argjson', name, JSON.stringify(v ?? null));
  }
  const out = await shared.run(JSON.stringify(value ?? null), filter, flags, timeoutMs);
  if (out.length === 0) return null;
  if (out.length === 1) return out[0];
  return out;
}
