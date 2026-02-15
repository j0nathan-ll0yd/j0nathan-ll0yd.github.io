import { cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repoRoot = join(root, '..', '..');

const publicCss = join(root, 'public', 'css');
const publicAssets = join(root, 'public', 'assets');

mkdirSync(publicCss, { recursive: true });
mkdirSync(publicAssets, { recursive: true });

const cssFiles = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'effects.css'];
for (const file of cssFiles) {
  cpSync(join(repoRoot, 'css', file), join(publicCss, file));
}

const assetFiles = ['avatar.svg', 'favicon.svg'];
for (const file of assetFiles) {
  cpSync(join(repoRoot, 'assets', file), join(publicAssets, file));
}

console.log('Assets copied to public/');
