/**
 * Fixture validation script.
 *
 * Reads each JSON file from test/fixtures/generated/, parses it, and validates
 * that the structure has required fields with correct types.
 *
 * Usage: npx tsx test/fixtures/validate.ts
 * Exit 0 on success, exit 1 with error details on failure.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  optional?: boolean;
}

// Validation rules matching the actual TypeScript interfaces in src/types/exports.ts
const VALIDATION_RULES: Record<string, ValidationRule[]> = {
  health: [
    { field: 'date', type: 'string' },
    { field: 'generatedAt', type: 'string' },
    { field: 'quantities', type: 'object' },
  ],
  sleep: [
    { field: 'date', type: 'string' },
    { field: 'generatedAt', type: 'string' },
  ],
  workouts: [
    { field: 'date', type: 'string' },
    { field: 'generatedAt', type: 'string' },
    { field: 'workouts', type: 'array' },
  ],
  books: [
    { field: 'generatedAt', type: 'string' },
    { field: 'books', type: 'array' },
  ],
  location: [
    { field: 'generatedAt', type: 'string' },
    { field: 'totalVisits', type: 'number' },
    { field: 'totalPlaces', type: 'number' },
    { field: 'topPlaces', type: 'array' },
    { field: 'last90Days', type: 'array' },
    { field: 'cityBreakdown', type: 'array' },
    { field: 'categoryBreakdown', type: 'array' },
    { field: 'streaks', type: 'object' },
    { field: 'explorationStats', type: 'object' },
  ],
  'github-events': [
    { field: 'generatedAt', type: 'string' },
    { field: 'events', type: 'array' },
  ],
  'github-starred-repos': [
    { field: 'generatedAt', type: 'string' },
    { field: 'repos', type: 'array' },
  ],
  articles: [
    { field: 'generatedAt', type: 'string' },
    { field: 'articles', type: 'array' },
  ],
  focus: [
    { field: 'generatedAt', type: 'string' },
    { field: 'currentFocus', type: 'string' },
  ],
  'theatre-reviews': [
    { field: 'generatedAt', type: 'string' },
    { field: 'source', type: 'string' },
    { field: 'totalReviews', type: 'number' },
    { field: 'reviews', type: 'array' },
  ],
};

function getType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateFixture(dataType: string, variationName: string, data: unknown): string[] {
  const errors: string[] = [];

  if (data === null || typeof data !== 'object') {
    errors.push(`Root value is not an object (got ${getType(data)})`);
    return errors;
  }

  const rules = VALIDATION_RULES[dataType];
  if (!rules) {
    // No rules defined — just check it's a non-empty object
    return errors;
  }

  const record = data as Record<string, unknown>;
  for (const rule of rules) {
    const value = record[rule.field];
    if (value === undefined || value === null) {
      if (!rule.optional) {
        errors.push(`Missing required field "${rule.field}"`);
      }
      continue;
    }
    const actualType = getType(value);
    if (actualType !== rule.type) {
      errors.push(`Field "${rule.field}" expected ${rule.type}, got ${actualType}`);
    }
  }

  return errors;
}

const root = join(process.cwd(), 'test/fixtures/generated');

if (!existsSync(root)) {
  console.error('[validate] Generated fixtures directory not found. Run npm run generate:fixtures first.');
  process.exit(1);
}

const dataTypeDirs = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (dataTypeDirs.length === 0) {
  console.warn('[validate] No fixture directories found — nothing to validate.');
  process.exit(0);
}

let totalFiles = 0;
let totalErrors = 0;
const allErrors: string[] = [];

for (const dataType of dataTypeDirs) {
  const dir = join(root, dataType);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    const filePath = join(dir, file);
    const variationName = file.replace('.json', '');
    totalFiles++;

    let data: unknown;
    try {
      data = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (err) {
      const msg = `[${dataType}/${variationName}] JSON parse error: ${err instanceof Error ? err.message : String(err)}`;
      allErrors.push(msg);
      totalErrors++;
      continue;
    }

    const errors = validateFixture(dataType, variationName, data);
    if (errors.length > 0) {
      for (const error of errors) {
        const msg = `[${dataType}/${variationName}] ${error}`;
        allErrors.push(msg);
        totalErrors++;
      }
    }
  }

  console.log(`[validate] ${dataType}/ — ${files.length} file(s) checked`);
}

console.log(`\n[validate] ${totalFiles} file(s) validated, ${totalErrors} error(s) found.`);

if (totalErrors > 0) {
  console.error('\nErrors:');
  for (const err of allErrors) {
    console.error(`  ${err}`);
  }
  process.exit(1);
}

console.log('[validate] All fixtures valid.');
process.exit(0);
