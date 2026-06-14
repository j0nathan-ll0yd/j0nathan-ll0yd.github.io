import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, 'dist');

// Book-image coverage (every book ASIN has a pre-fetched local webp) is no
// longer asserted here: fixtures are DS-owned (Plan #04) and the SSR-shell
// books are synthetic, so they intentionally ship no local images. Real
// production book images are fetched from CloudFront at build (fetch:images)
// and cached by the service worker; that pipeline is unchanged.
describe('Image Pipeline', () => {
  describe('dist/ artifacts', () => {
    it('dist/sw.js exists', () => {
      const swPath = path.join(distDir, 'sw.js');
      expect(existsSync(swPath)).toBe(true);
    });

    it('dist/manifest.webmanifest exists', () => {
      const manifestPath = path.join(distDir, 'manifest.webmanifest');
      expect(existsSync(manifestPath)).toBe(true);
    });

    it('dist/manifest.webmanifest is valid JSON', () => {
      const manifestPath = path.join(distDir, 'manifest.webmanifest');
      const content = readFileSync(manifestPath, 'utf-8');
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('dist/manifest.webmanifest has required PWA fields', () => {
      const manifestPath = path.join(distDir, 'manifest.webmanifest');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.name).toBeTruthy();
      expect(manifest.icons).toBeDefined();
    });

    it('dist/index.html exists', () => {
      const indexPath = path.join(distDir, 'index.html');
      expect(existsSync(indexPath)).toBe(true);
    });

    it('dist/index.html is non-empty', () => {
      const indexPath = path.join(distDir, 'index.html');
      const stat = statSync(indexPath);
      expect(stat.size).toBeGreaterThan(0);
    });
  });
});
