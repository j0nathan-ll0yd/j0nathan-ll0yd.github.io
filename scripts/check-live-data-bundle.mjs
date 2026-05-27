// Verifies the live-data bundle is present in dist/_astro/.
//
// Catches the class of bug where Rollup tree-shakes a side-effect-only
// `import '@lifegames/web/runtime/live-data'` because the upstream package
// marks .ts files as side-effect-free, producing an empty <script></script>
// tag in production. The build itself succeeds silently.
//
// We assert that at least one bundled `index.astro_astro_type_script_index_*_lang.*.js`
// chunk contains string literals that only live-data emits (DOM element IDs
// plus the live-data dispatch table). Function identifiers are minified; DOM
// IDs and dispatch keys survive minification because they're string literals.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const astroDir = resolve(process.cwd(), 'dist', '_astro');
const BUNDLE_RE = /^index\.astro_astro_type_script_index_\d+_lang\.[A-Za-z0-9_-]+\.js$/;
const REQUIRED = ['cardTheatreReviews', 'systemStatus', 'theatreReviews'];

let files;
try {
  files = readdirSync(astroDir);
} catch (err) {
  console.error('[check-live-data-bundle] Could not read', astroDir, ':', err.message);
  process.exit(1);
}

const bundles = files.filter(f => BUNDLE_RE.test(f));
if (bundles.length === 0) {
  console.error('[check-live-data-bundle] No index.astro module bundles found in', astroDir);
  process.exit(1);
}

const found = Object.fromEntries(REQUIRED.map(t => [t, null]));
for (const file of bundles) {
  const content = readFileSync(resolve(astroDir, file), 'utf-8');
  for (const token of REQUIRED) {
    if (found[token] === null && content.includes(token)) found[token] = file;
  }
}

const missing = REQUIRED.filter(t => found[t] === null);
if (missing.length > 0) {
  console.error('[check-live-data-bundle] Live-data bundle missing required identifiers:');
  for (const t of missing) console.error('  -', t);
  console.error('');
  console.error('Likely cause: @lifegames/web/runtime/live-data was tree-shaken because its');
  console.error('side-effect-only import was treated as side-effect-free. Verify the');
  console.error('`sideEffects` array in @lifegames/web/package.json includes the runtime entry.');
  console.error('Inspected bundles:', bundles.join(', '));
  process.exit(1);
}

const uniqueFiles = new Set(Object.values(found));
console.log(
  '[check-live-data-bundle] OK —',
  REQUIRED.length,
  'identifiers present across',
  uniqueFiles.size,
  'bundle(s).',
);
