import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, 'dist');
const dataDir = path.resolve(rootDir, 'data');
const publicImagesDir = path.resolve(rootDir, 'public/images');

describe('Image Pipeline', () => {
  describe('Book images', () => {
    it('all books in books.json have a corresponding local webp image', () => {
      const booksData = JSON.parse(readFileSync(path.join(dataDir, 'books.json'), 'utf-8'));
      const books: Array<{ asin: string; title: string }> = booksData.books;

      const missing: string[] = [];
      for (const book of books) {
        const imagePath = path.join(publicImagesDir, 'books', `${book.asin}.webp`);
        if (!existsSync(imagePath)) {
          missing.push(`${book.title} (${book.asin})`);
        }
      }
      expect(missing, `Missing book images: ${missing.join(', ')}`).toHaveLength(0);
    });

    it('no book images are zero bytes', () => {
      const booksData = JSON.parse(readFileSync(path.join(dataDir, 'books.json'), 'utf-8'));
      const books: Array<{ asin: string; title: string }> = booksData.books;

      const zeroBytes: string[] = [];
      for (const book of books) {
        const imagePath = path.join(publicImagesDir, 'books', `${book.asin}.webp`);
        if (existsSync(imagePath)) {
          const stat = statSync(imagePath);
          if (stat.size === 0) {
            zeroBytes.push(`${book.title} (${book.asin})`);
          }
        }
      }
      expect(zeroBytes, `Zero-byte images: ${zeroBytes.join(', ')}`).toHaveLength(0);
    });
  });

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
