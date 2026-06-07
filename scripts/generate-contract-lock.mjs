#!/usr/bin/env node
// generate-contract-lock.mjs — Generate .contract-lock.json for the web repo.
// Tracks the @lifegames/schemas package consumed via yalc from design-system-Lifegames.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const LOCK_FILE = join(REPO_ROOT, '.contract-lock.json');
const SCHEMAS_PKG = join(REPO_ROOT, '.yalc', '@lifegames', 'schemas');

function sha256(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

if (!existsSync(SCHEMAS_PKG)) {
  console.error('[contract-lock] ERROR: .yalc/@lifegames/schemas not found.');
  console.error('  Run `pnpm yalc:publish` from design-system-Lifegames first.');
  process.exit(1);
}

// Read the DS SHA from the yalc package's .lp-sync-manifest.json or yalc.lock
let dsSha = null;
const manifestPath = join(SCHEMAS_PKG, 'vendored', '.lp-sync-manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  dsSha = manifest.lpGitSha ?? null;
}

// Also try to get DS repo HEAD directly if available as a sibling
const dsRepoRoot = join(REPO_ROOT, '..', 'design-system-Lifegames');
let dsRepoSha = null;
try {
  dsRepoSha = execSync('git rev-parse HEAD', { cwd: dsRepoRoot, encoding: 'utf-8' }).trim();
} catch {
  // DS repo not available as sibling — use manifest SHA
}

const upstreamSha = dsRepoSha ?? dsSha ?? 'unknown';

// Collect all schema-relevant files from the yalc package
// Include vendored schemas, authored schemas, generated schemas, and dist types
const filePatterns = [
  { dir: join(SCHEMAS_PKG, 'vendored'), filter: f => f.endsWith('.schema.json') },
  { dir: join(SCHEMAS_PKG, 'authored'), filter: f => f.endsWith('.schema.json') },
  { dir: join(SCHEMAS_PKG, 'generated'), filter: f => f.endsWith('.schema.json') },
];

const checksums = {};
const allContents = [];

for (const { dir, filter } of filePatterns) {
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter(filter).sort();
  for (const file of files) {
    const relPath = dir.includes('vendored') ? `vendored/${file}`
      : dir.includes('authored') ? `authored/${file}`
      : `generated/${file}`;
    const content = readFileSync(join(dir, file), 'utf-8');
    checksums[relPath] = `sha256:${sha256(content)}`;
    allContents.push(content);
  }
}

const aggregateChecksum = `sha256:${sha256(allContents.join(''))}`;

const lock = {
  generatedFrom: {
    repo: 'j0nathan-ll0yd/design-system-Lifegames',
    sha: upstreamSha,
    checksum: aggregateChecksum,
  },
  generatedAt: new Date().toISOString(),
  generatorVersion: '1.0.0',
  files: checksums,
};

writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
console.log(`[contract-lock] Generated ${LOCK_FILE}`);
console.log(`  upstream: j0nathan-ll0yd/design-system-Lifegames@${upstreamSha.slice(0, 8)}`);
console.log(`  aggregate: ${aggregateChecksum}`);
console.log(`  files: ${Object.keys(checksums).length}`);
