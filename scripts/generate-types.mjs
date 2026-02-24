#!/usr/bin/env node
/**
 * Generates TypeScript types from JSON Schema files produced by the backend.
 *
 * Local dev: reads schemas from ../mantle-Lifegames-Portal/schemas/
 * CI: reads schemas from ./schemas/ (populated by fetch-schemas.sh)
 *
 * Usage: node scripts/generate-types.mjs
 */
import { compile } from 'json-schema-to-typescript';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

// Try local backend path first, then fall back to local schemas/ dir (CI)
const backendSchemas = resolve(projectRoot, '../mantle-Lifegames-Portal/schemas');
const localSchemas = resolve(projectRoot, 'schemas');
const schemasDir = existsSync(backendSchemas) ? backendSchemas : localSchemas;

if (!existsSync(schemasDir)) {
  console.error('No schemas directory found. Run fetch-schemas.sh first (CI) or ensure backend repo is adjacent.');
  process.exit(1);
}

const outFile = resolve(projectRoot, 'src/types/exports.ts');

const schemaFiles = readdirSync(schemasDir).filter(f => f.endsWith('.schema.json')).sort();

let output = `/**
 * Generated from backend JSON Schema files.
 * Do not edit manually — regenerate with: npm run generate:types
 *
 * Source: mantle-Lifegames-Portal/schemas/*.schema.json
 */\n\n`;

for (const file of schemaFiles) {
  const schemaPath = resolve(schemasDir, file);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
  const ts = await compile(schema, basename(file, '.schema.json'), {
    bannerComment: '',
    additionalProperties: false,
    style: { semi: true, singleQuote: true },
  });
  output += ts + '\n';
}

writeFileSync(outFile, output);
console.log(`Generated ${schemaFiles.length} types → ${outFile}`);
