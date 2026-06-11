import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Schemas use draft-07
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const AUTHORED_DIR = path.join(repoRoot, 'node_modules/@lifegames/schemas/authored');
const GENERATED_DIR = path.join(repoRoot, 'node_modules/@lifegames/schemas/generated');
// Raw export schemas are now produced by the backend and published via
// @lifegames/portal-contract (the design system no longer vendors them).
const VENDORED_DIR = path.join(repoRoot, 'node_modules/@lifegames/portal-contract/raw-schemas');
const FIXTURE_DIR = path.join(repoRoot, 'test/fixtures/build-data');

// Pre-load the raw export schemas so $ref resolution works for dashboard-health.
// They have no $id, so we assign the URI that authored schemas reference
// (the canonical "vendored" namespace is preserved for backward compatibility):
// https://lifegames.dev/vendored/<filename>
for (const fname of fs.readdirSync(VENDORED_DIR)) {
  if (fname.endsWith('.schema.json')) {
    const schemaDef = JSON.parse(fs.readFileSync(path.join(VENDORED_DIR, fname), 'utf-8'));
    schemaDef.$id = `https://lifegames.dev/vendored/${fname}`;
    ajv.addSchema(schemaDef);
  }
}

const FIXTURES = [
  { file: 'profile.json', schema: 'profile.schema.json' },
  { file: 'health.json', schema: 'dashboard-health.schema.json' },
  { file: 'github.json', schema: 'dashboard-github.schema.json' },
  { file: 'reading.json', schema: 'dashboard-reading.schema.json' },
  { file: 'books.json', schema: 'dashboard-books.schema.json' },
  { file: 'system.json', schema: 'system.schema.json' },
];

let failed = 0;

for (const { file, schema } of FIXTURES) {
  const authoredPath = path.join(AUTHORED_DIR, schema);
  const generatedPath = path.join(GENERATED_DIR, schema);
  const schemaPath = fs.existsSync(authoredPath) ? authoredPath : generatedPath;
  const fixturePath = path.join(FIXTURE_DIR, file);

  const schemaDef = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

  const validate = ajv.compile(schemaDef);
  const valid = validate(fixture);

  if (!valid) {
    console.error(`FAIL ${file}:`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || '(root)'} ${err.message}`);
    }
    failed++;
  } else {
    console.log(`OK   ${file}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} fixture(s) failed validation.`);
  process.exit(1);
}

console.log(`\nAll ${FIXTURES.length} fixtures valid.`);
