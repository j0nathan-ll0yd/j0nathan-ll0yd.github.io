// Verifies the live-data bundle is present in dist/_astro/.
//
// Catches the class of bug where Rollup tree-shakes the side-effect-only
// `import '../lib/runtime/live-data'` (in src/pages/index.astro), producing an
// empty <script></script> tag in production. The build itself succeeds silently.
// The data runtime is app-local under src/lib/runtime/ — relocated out of the
// @lifegames/web design-system package (see ADR 0005 in design-system-Lifegames).
//
// We assert that the live-data runtime — reachable from the entry
// `index.astro_astro_type_script_index_*_lang.*.js` chunk(s) — contains string
// literals that only it emits (DOM element IDs plus the live-data dispatch
// table). Function identifiers are minified; DOM IDs and dispatch keys survive
// minification because they're string literals.
//
// The search follows Rollup's code-split imports transitively: the updaters live
// in a shared `_astro/<name>.js` chunk that the entry imports, not necessarily
// inlined into the entry chunk itself. Following the import graph keeps this
// robust to chunking changes (e.g. when an updater grows past the inline
// threshold) while still catching genuine tree-shaking (the token vanishing from
// the whole reachable graph).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const astroDir = resolve(process.cwd(), 'dist', '_astro');
const BUNDLE_RE = /^index\.astro_astro_type_script_index_\d+_lang\.[A-Za-z0-9_-]+\.js$/;
const REQUIRED = ['cardTheatreReviews', 'systemStatus', 'theatreReviews'];
// Matches a relative chunk reference (`"./updaters.fDuJCGys.js"`) in minified output,
// whether via static import, dynamic import, or re-export.
const CHUNK_REF_RE = /\.\/([A-Za-z0-9_.-]+\.js)/g;

let files;
try {
  files = readdirSync(astroDir);
} catch (err) {
  console.error('[check-live-data-bundle] Could not read', astroDir, ':', err.message);
  process.exit(1);
}

const fileSet = new Set(files);
const entryBundles = files.filter((f) => BUNDLE_RE.test(f));
if (entryBundles.length === 0) {
  console.error('[check-live-data-bundle] No index.astro module bundles found in', astroDir);
  process.exit(1);
}

// Transitively collect every chunk reachable from the entry bundle(s).
const reachable = new Set();
const queue = [...entryBundles];
while (queue.length > 0) {
  const file = queue.pop();
  if (reachable.has(file) || !fileSet.has(file)) continue;
  reachable.add(file);
  const content = readFileSync(resolve(astroDir, file), 'utf-8');
  for (const m of content.matchAll(CHUNK_REF_RE)) {
    if (!reachable.has(m[1])) queue.push(m[1]);
  }
}

const found = Object.fromEntries(REQUIRED.map((t) => [t, null]));
for (const file of reachable) {
  const content = readFileSync(resolve(astroDir, file), 'utf-8');
  for (const token of REQUIRED) {
    if (found[token] === null && content.includes(token)) found[token] = file;
  }
}

const missing = REQUIRED.filter((t) => found[t] === null);
if (missing.length > 0) {
  console.error('[check-live-data-bundle] Live-data bundle missing required identifiers:');
  for (const t of missing) console.error('  -', t);
  console.error('');
  console.error('Likely cause: src/lib/runtime/live-data was tree-shaken or is no longer imported.');
  console.error("Verify src/pages/index.astro still has `import '../lib/runtime/live-data'` and");
  console.error('that the module retains its top-level side effects (skeleton removal, polling, WS).');
  console.error('Inspected', reachable.size, 'reachable chunk(s) from:', entryBundles.join(', '));
  process.exit(1);
}

const uniqueFiles = new Set(Object.values(found));
console.log(
  '[check-live-data-bundle] OK —',
  REQUIRED.length,
  'identifiers present across',
  uniqueFiles.size,
  'chunk(s), from',
  reachable.size,
  'reachable.',
);
