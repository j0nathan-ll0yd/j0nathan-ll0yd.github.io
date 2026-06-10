#!/usr/bin/env node
// check-contract-lock.mjs -- Detect hand-edits to .contract-lock.json.
//
// Tier 1/2/3 enforcement (Plan #11). The committed .contract-lock.json must
// match what `scripts/generate-contract-lock.mjs` would produce for the current
// .yalc/@lifegames/schemas tree. This guards the *checksum* fields against
// hand-edits -- the failure mode `verify-contract.mjs` does NOT catch.
//
// Why not `generate-contract-lock.mjs && git diff --exit-code`?
//   The generator writes two intentionally-volatile fields -- `generatedAt`
//   (wall-clock timestamp) and `generatedFrom.sha` (live DS repo HEAD when a
//   sibling checkout exists). A raw diff would therefore fire on every run,
//   regardless of drift. This check compares only the load-bearing checksum
//   fields (`files` + `generatedFrom.checksum`), so it is deterministic and
//   fires *only* on a genuine hand-edit or a stale (un-regenerated) lock.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LOCK_FILE = join(REPO_ROOT, '.contract-lock.json');
const SCHEMAS_PKG = join(REPO_ROOT, '.yalc', '@lifegames', 'schemas');

function sha256(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function fail(message) {
  console.error('');
  console.error('ERROR: .contract-lock.json drift detected.');
  console.error('  ' + message);
  console.error('');
  console.error('  Hand-edits to the checksum fields are forbidden.');
  console.error('  To fix: node scripts/generate-contract-lock.mjs && git add .contract-lock.json');
  console.error('');
  process.exit(1);
}

if (!existsSync(LOCK_FILE)) {
  fail('.contract-lock.json is missing.');
}
if (!existsSync(SCHEMAS_PKG)) {
  // Cannot recompute -- this is an environment problem, not a hand-edit.
  // Surface clearly and exit non-zero so CI/pre-commit notice it.
  console.error('[check-contract-lock] ERROR: .yalc/@lifegames/schemas not found.');
  console.error('  Run `pnpm yalc:publish` from design-system-Lifegames first (or `bash scripts/ci-setup.sh` in CI).');
  process.exit(1);
}

const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
const lockedFiles = lock.files ?? {};
const lockedAggregate = lock.generatedFrom?.checksum ?? '';

// Recompute the checksum-bearing fields exactly as generate-contract-lock.mjs does.
const filePatterns = [
  { dir: join(SCHEMAS_PKG, 'vendored'), prefix: 'vendored', filter: (f) => f.endsWith('.schema.json') },
  { dir: join(SCHEMAS_PKG, 'authored'), prefix: 'authored', filter: (f) => f.endsWith('.schema.json') },
  { dir: join(SCHEMAS_PKG, 'generated'), prefix: 'generated', filter: (f) => f.endsWith('.schema.json') },
];

const currentFiles = {};
const allContents = [];
for (const { dir, prefix, filter } of filePatterns) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(filter).sort();
  for (const file of files) {
    const relPath = `${prefix}/${file}`;
    const content = readFileSync(join(dir, file), 'utf-8');
    currentFiles[relPath] = `sha256:${sha256(content)}`;
    allContents.push(content);
  }
}
const currentAggregate = `sha256:${sha256(allContents.join(''))}`;

const drift = [];

for (const [file, actual] of Object.entries(currentFiles)) {
  const expected = lockedFiles[file];
  if (!expected) {
    drift.push(`NEW: ${file} present on disk but absent from lock`);
  } else if (actual !== expected) {
    drift.push(`CHANGED: ${file} (lock ${expected} != actual ${actual})`);
  }
}
for (const file of Object.keys(lockedFiles)) {
  if (!currentFiles[file]) {
    drift.push(`REMOVED: ${file} present in lock but absent on disk`);
  }
}
if (currentAggregate !== lockedAggregate) {
  drift.push(`AGGREGATE: lock ${lockedAggregate} != actual ${currentAggregate}`);
}

if (drift.length > 0) {
  fail('Lock checksums do not match the current schemas:\n  ' + drift.join('\n  '));
}

console.log('[check-contract-lock] OK: .contract-lock.json checksums match current schemas.');
