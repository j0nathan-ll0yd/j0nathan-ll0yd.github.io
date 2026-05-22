import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const checksums = JSON.parse(
  readFileSync(resolve(__dirname, '.css-checksums.json'), 'utf8')
);

let failed = false;

for (const [relPath, expected] of Object.entries(checksums)) {
  const fullPath = resolve(root, relPath);
  let actual;
  try {
    const content = readFileSync(fullPath);
    actual = createHash('sha256').update(content).digest('hex');
  } catch {
    console.error(`ERROR: Cannot read ${relPath}`);
    failed = true;
    continue;
  }
  if (actual !== expected) {
    console.error(`DRIFT DETECTED: ${relPath}`);
    console.error(`  expected: ${expected}`);
    console.error(`  actual:   ${actual}`);
    failed = true;
  }
}

if (failed) {
  console.error('\nCSS drift detected. Run: npm run sync:css -- --source <design-system-path>');
  process.exit(1);
} else {
  console.log('CSS drift check passed — all checksums match.');
}
