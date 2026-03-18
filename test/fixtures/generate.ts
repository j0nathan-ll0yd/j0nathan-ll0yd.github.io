/**
 * Fixture generator script.
 *
 * Imports all variation records from ./variations/index and writes JSON files to
 * test/fixtures/generated/{dataType}/{variationName}.json
 *
 * Usage: npx tsx test/fixtures/generate.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as allVariations from './variations/index';

const DIRECTORY_MAP: Record<string, string> = {
  health: 'health',
  sleep: 'sleep',
  workouts: 'workouts',
  books: 'books',
  location: 'location',
  githubEvents: 'github-events',
  starredRepos: 'github-starred-repos',
  articles: 'articles',
  focus: 'focus',
  theatreReviews: 'theatre-reviews',
};

/** Convert camelCase string to kebab-case. */
function toKebabCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`)
    .replace(/^-/, '');
}

const root = join(process.cwd(), 'test/fixtures/generated');
let totalFiles = 0;

for (const [dataType, directory] of Object.entries(DIRECTORY_MAP)) {
  const variationsKey = `${dataType}Variations`;
  const variations = (allVariations as Record<string, Record<string, unknown> | undefined>)[variationsKey];
  if (!variations || typeof variations !== 'object') {
    console.warn(`[generate] No variations found for "${variationsKey}" — skipping`);
    continue;
  }

  const dir = join(root, directory);
  mkdirSync(dir, { recursive: true });

  let count = 0;
  for (const [variationName, value] of Object.entries(variations)) {
    const filename = `${toKebabCase(variationName)}.json`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
    count++;
    totalFiles++;
  }

  console.log(`[generate] ${dataType} → ${directory}/ (${count} files)`);
}

console.log(`\n[generate] Done — wrote ${totalFiles} fixture files.`);
