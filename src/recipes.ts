// Saved recipes: chains stored as YAML files in recipesDir (default ~/.mcp-pipe/recipes).
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { defaultDir } from './config.js';
import { parseChain, type Chain } from './chain/schema.js';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EXTS = ['.yaml', '.yml', '.json'];

export const recipesDir = (dir?: string) => dir ?? path.join(defaultDir(), 'recipes');

export function checkName(name: string): void {
  if (!NAME.test(name)) throw new Error(`recipe name "${name}" must be letters, digits, "-" or "_" (max 64), no paths`);
}

function fileFor(dir: string, name: string): string | undefined {
  for (const ext of EXTS) {
    const p = path.join(dir, name + ext);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export function loadRecipe(dir: string, name: string): Chain {
  checkName(name);
  const file = fileFor(dir, name);
  if (!file) {
    const names = listRecipes(dir).map((r) => r.name);
    throw new Error(`no recipe "${name}" in ${dir}${names.length ? `; available: ${names.join(', ')}` : ''}`);
  }
  try {
    return parseChain(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`recipe "${name}" (${file}): ${(e as Error).message}`);
  }
}

export function saveRecipe(dir: string, name: string, chain: Chain, opts: { description?: string; overwrite?: boolean } = {}): string {
  checkName(name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const existing = fileFor(dir, name);
  if (existing && !opts.overwrite) throw new Error(`recipe "${name}" already exists (${existing}); pass overwrite: true to replace it`);
  const file = existing ?? path.join(dir, `${name}.yaml`);
  const doc = {
    recipe: name,
    ...(opts.description ?? chain.description ? { description: opts.description ?? chain.description } : {}),
    ...(chain.params ? { params: chain.params } : {}),
    steps: chain.steps,
  };
  fs.writeFileSync(file, stringify(doc), { mode: 0o600 });
  return file;
}

export type RecipeInfo = { name: string; description?: string; params?: Chain['params']; error?: string };

export function listRecipes(dir: string): RecipeInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: RecipeInfo[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const ext = path.extname(f);
    if (!EXTS.includes(ext)) continue;
    const name = path.basename(f, ext);
    try {
      const c = parseChain(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ name, ...(c.description ? { description: c.description } : {}), ...(c.params ? { params: c.params } : {}) });
    } catch (e) {
      out.push({ name, error: (e as Error).message });
    }
  }
  return out;
}
