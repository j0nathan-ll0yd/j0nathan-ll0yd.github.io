import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  let source = resolve(REPO_ROOT, '..', 'lifegames-design-system');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      source = resolve(args[i + 1]);
      i++;
    }
  }
  return { source };
}

function stripHeader(content) {
  const lines = content.split('\n');
  // Strip the leading 2-line "Ported from" comment block + following blank line.
  // Pattern: line 0 starts with "/* Ported from", line 1 starts with " *" or " ", line 2 is blank.
  if (
    lines.length >= 3 &&
    lines[0].startsWith('/* Ported from') &&
    lines[2] === ''
  ) {
    return lines.slice(3).join('\n');
  }
  return content;
}

function sha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function diffIgnoringComments(a, b) {
  const stripCommentLines = (s) =>
    s.split('\n').filter((l) => !l.trim().startsWith('/*') && !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  const aLines = stripCommentLines(a).join('\n').trim();
  const bLines = stripCommentLines(b).join('\n').trim();
  return aLines !== bLines;
}

function main() {
  const { source } = parseArgs();

  if (!existsSync(source)) {
    console.error(`ERROR: design-system source not found at: ${source}`);
    process.exit(1);
  }

  const SYNC_FILES = [
    {
      src: resolve(source, 'packages/tokens/src/components.css'),
      dest: resolve(REPO_ROOT, 'public/css/components.css'),
      key: 'public/css/components.css',
    },
    {
      src: resolve(source, 'packages/tokens/src/effects.css'),
      dest: resolve(REPO_ROOT, 'public/css/effects.css'),
      key: 'public/css/effects.css',
    },
    {
      src: resolve(source, 'packages/tokens/src/layout.css'),
      dest: resolve(REPO_ROOT, 'src/styles/layout.css'),
      key: 'src/styles/layout.css',
    },
  ];

  const checksums = {};
  const synced = [];

  for (const { src, dest, key } of SYNC_FILES) {
    if (!existsSync(src)) {
      console.error(`ERROR: source file not found: ${src}`);
      process.exit(1);
    }
    const raw = readFileSync(src, 'utf8');
    const stripped = stripHeader(raw);
    writeFileSync(dest, stripped, 'utf8');
    checksums[key] = sha256(stripped);
    synced.push(key);
    console.log(`  synced: ${key}`);
  }

  // base.css diff check (informational only)
  const baseSrc = resolve(source, 'packages/tokens/src/base.css');
  const baseDest = resolve(REPO_ROOT, 'public/css/base.css');
  let baseWarning = false;
  if (existsSync(baseSrc) && existsSync(baseDest)) {
    const baseSrcContent = readFileSync(baseSrc, 'utf8');
    const baseDestContent = readFileSync(baseDest, 'utf8');
    const strippedSrc = stripHeader(baseSrcContent);
    if (diffIgnoringComments(strippedSrc, baseDestContent)) {
      console.warn('\nWARNING: base.css has non-comment differences between DS and production.');
      console.warn(`  DS:   ${baseSrc}`);
      console.warn(`  Prod: ${baseDest}`);
      baseWarning = true;
    }
  } else {
    console.warn('\nWARNING: base.css could not be compared (one or both files missing).');
    baseWarning = true;
  }

  // Write checksums
  const checksumsPath = resolve(__dirname, '.css-checksums.json');
  writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + '\n', 'utf8');

  console.log('\nSync complete.');
  console.log(`  Files synced: ${synced.length}`);
  console.log(`  Checksums written to: ${checksumsPath}`);
  for (const [k, v] of Object.entries(checksums)) {
    console.log(`    ${k}: ${v}`);
  }
  console.log(`  base.css warnings: ${baseWarning ? 1 : 0}`);
}

main();
