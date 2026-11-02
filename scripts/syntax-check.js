/** Static check: `node --check` on every .js file in the API (no dependencies needed). */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.js')) files.push(full);
  }
})(root);

let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { failed += 1; console.error(`FAIL ${f}\n${r.stderr}`); }
}
console.log(`${files.length - failed}/${files.length} files passed syntax check`);
process.exit(failed ? 1 : 0);
