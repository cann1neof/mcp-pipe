import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The usage skill shipped in the package (skills/mcp-pipe/SKILL.md, next to dist/ and src/). */
export const skillSource = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'mcp-pipe', 'SKILL.md');

/** Copies the usage skill into `<dir>/mcp-pipe/SKILL.md` (default ~/.claude/skills). Returns the written path. */
export function installSkill(dir?: string): string {
  const base = dir ? path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir())) : path.join(os.homedir(), '.claude', 'skills');
  const target = path.join(base, 'mcp-pipe', 'SKILL.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(skillSource(), target);
  console.log(`wrote ${target}`);
  return target;
}
