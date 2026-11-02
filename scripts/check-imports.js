/** Static check without installing anything: every relative import resolves to a file, and every named import is exported there. */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const f = join(d, n);
    if (statSync(f).isDirectory()) walk(f); else if (n.endsWith('.js')) files.push(f);
  }
})(root);

const exportsOf = (src) => {
  const set = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/g)) set.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) m[1].split(',').forEach((x) => set.add(x.trim().split(/\s+as\s+/).pop()));
  if (/export\s+default/.test(src)) set.add('default');
  return set;
};
const cache = new Map();
const getExports = (f) => { if (!cache.has(f)) cache.set(f, exportsOf(readFileSync(f, 'utf8'))); return cache.get(f); };

const problems = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:\*\s+as\s+[\w$]+\s*)?from\s+['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(f), m[3]);
    if (!existsSync(target)) { problems.push(`${f}: missing file ${m[3]}`); continue; }
    const ex = getExports(target);
    if (m[1] && !ex.has('default')) problems.push(`${f}: ${m[3]} has no default export`);
    for (const name of (m[2] || '').split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!ex.has(name)) problems.push(`${f}: "${name}" is not exported by ${m[3]}`);
    }
  }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Import check passed for ${files.length} files`);
