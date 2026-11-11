import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const tsxBin = path.join(root, 'node_modules', '.bin', 'tsx');
export const fixture = (name: string) => path.join(root, 'test', 'fixtures', `${name}.ts`);
export const fixtureServer = (name: string) => ({ command: tsxBin, args: [fixture(name)] });
