#!/usr/bin/env node
// verify-contract.mjs — Verify .contract-lock.json matches current @lifegames/schemas.
// Exit 0 on match (or warning mode), non-zero on drift in blocking mode.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LOCK_FILE = join(REPO_ROOT, '.contract-lock.json');
const SCHEMAS_PKG = join(REPO_ROOT, '.yalc', '@lifegames', 'schemas');

const WARNING_MODE = process.env.CONTRACT_CHECK_MODE !== 'blocking';

function sha256(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

if (!existsSync(LOCK_FILE)) {
  console.warn('[contract-check] No .contract-lock.json found — run `node scripts/generate-contract-lock.mjs` first');
  process.exit(WARNING_MODE ? 0 : 1);
}

if (!existsSync(SCHEMAS_PKG)) {
  console.warn('[contract-check] .yalc/@lifegames/schemas not found — cannot verify.');
  process.exit(WARNING_MODE ? 0 : 1);
}

const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
const expectedChecksums = lock.files ?? {};
const expectedAggregate = lock.generatedFrom?.checksum ?? '';

// Rebuild current checksums from the same directories
const filePatterns = [
  { dir: join(SCHEMAS_PKG, 'vendored'), prefix: 'vendored', filter: f => f.endsWith('.schema.json') },
  { dir: join(SCHEMAS_PKG, 'authored'), prefix: 'authored', filter: f => f.endsWith('.schema.json') },
  { dir: join(SCHEMAS_PKG, 'generated'), prefix: 'generated', filter: f => f.endsWith('.schema.json') },
];

const currentChecksums = {};
const allContents = [];

for (const { dir, prefix, filter } of filePatterns) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(filter).sort();
  for (const file of files) {
    const relPath = `${prefix}/${file}`;
    const content = readFileSync(join(dir, file), 'utf-8');
    currentChecksums[relPath] = `sha256:${sha256(content)}`;
    allContents.push(content);
  }
}

let drifted = false;
const driftDetails = [];

// Check for changed or new files
for (const [file, actual] of Object.entries(currentChecksums)) {
  const expected = expectedChecksums[file];
  if (!expected) {
    driftDetails.push(`  NEW: ${file} (not in lock file)`);
    drifted = true;
  } else if (actual !== expected) {
    driftDetails.push(`  CHANGED: ${file}`);
    driftDetails.push(`    expected: ${expected}`);
    driftDetails.push(`    actual:   ${actual}`);
    drifted = true;
  }
}

// Check for removed files
for (const file of Object.keys(expectedChecksums)) {
  if (!currentChecksums[file]) {
    driftDetails.push(`  REMOVED: ${file} (in lock but not on disk)`);
    drifted = true;
  }
}

// Check aggregate
const actualAggregate = `sha256:${sha256(allContents.join(''))}`;
if (actualAggregate !== expectedAggregate) {
  drifted = true;
}

if (drifted) {
  const prefix = WARNING_MODE ? 'WARNING' : 'ERROR';
  console.error(`[contract-check] ${prefix}: Schema contract drift detected!`);
  console.error(`  upstream: ${lock.generatedFrom?.repo ?? 'unknown'}`);
  console.error(`  lock generated at: ${lock.generatedAt ?? 'unknown'}`);
  console.error(`  lock SHA: ${lock.generatedFrom?.sha?.slice(0, 8) ?? 'unknown'}`);
  if (driftDetails.length > 0) {
    console.error('  Details:');
    for (const d of driftDetails) console.error(d);
  }
  console.error('');
  console.error('  To resolve: run `node scripts/generate-contract-lock.mjs` after updating @lifegames/schemas.');
  if (WARNING_MODE) {
    console.warn('[contract-check] Running in WARNING mode — not blocking merge.');
    process.exit(0);
  } else {
    console.error('[contract-check] Running in BLOCKING mode — merge blocked.');
    process.exit(1);
  }
} else {
  console.log('[contract-check] OK: Schema contract verified.');
  console.log(`  upstream: ${lock.generatedFrom?.repo ?? 'unknown'}@${lock.generatedFrom?.sha?.slice(0, 8) ?? 'unknown'}`);
  console.log(`  aggregate: ${actualAggregate}`);
}
