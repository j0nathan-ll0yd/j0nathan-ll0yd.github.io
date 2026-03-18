import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const dataDir = path.resolve(process.cwd(), 'data');

function readJson(filename: string): any {
  const content = readFileSync(path.join(dataDir, filename), 'utf-8');
  return JSON.parse(content);
}

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe('Data File Integrity', () => {
  describe('health.json', () => {
    it('parses without error', () => {
      expect(() => readJson('health.json')).not.toThrow();
    });

    it('has a date field', () => {
      const data = readJson('health.json');
      expect(data.date).toBeTruthy();
      expect(typeof data.date).toBe('string');
    });

    it('has quantities object', () => {
      const data = readJson('health.json');
      expect(data.quantities).toBeDefined();
      expect(typeof data.quantities).toBe('object');
    });

    it('quantities has heartRate with value and unit', () => {
      const data = readJson('health.json');
      expect(data.quantities.heartRate).toBeDefined();
      expect(typeof data.quantities.heartRate.value).toBe('number');
      expect(data.quantities.heartRate.unit).toBeTruthy();
    });

    it('has sleep object with core/deep/rem/awake', () => {
      const data = readJson('health.json');
      expect(data.sleep).toBeDefined();
      expect(data.sleep.core).toBeDefined();
      expect(data.sleep.deep).toBeDefined();
      expect(data.sleep.rem).toBeDefined();
      expect(data.sleep.awake).toBeDefined();
    });
  });

  describe('books.json', () => {
    it('parses without error', () => {
      expect(() => readJson('books.json')).not.toThrow();
    });

    it('has books array', () => {
      const data = readJson('books.json');
      expect(Array.isArray(data.books)).toBe(true);
      expect(data.books.length).toBeGreaterThan(0);
    });

    it('each book has asin field', () => {
      const data = readJson('books.json');
      for (const book of data.books) {
        expect(book.asin).toBeTruthy();
      }
    });

    it('each book has title field', () => {
      const data = readJson('books.json');
      for (const book of data.books) {
        expect(book.title).toBeTruthy();
      }
    });

    it('each book has author field', () => {
      const data = readJson('books.json');
      for (const book of data.books) {
        expect(book.author).toBeTruthy();
      }
    });
  });

  describe('reading.json', () => {
    it('parses without error', () => {
      expect(() => readJson('reading.json')).not.toThrow();
    });

    it('has articles array', () => {
      const data = readJson('reading.json');
      expect(Array.isArray(data.articles)).toBe(true);
      expect(data.articles.length).toBeGreaterThan(0);
    });

    it('each article has title field', () => {
      const data = readJson('reading.json');
      for (const article of data.articles) {
        expect(article.title).toBeTruthy();
      }
    });

    it('each article has source field', () => {
      const data = readJson('reading.json');
      for (const article of data.articles) {
        expect(article.source).toBeTruthy();
      }
    });

    it('each article has category field', () => {
      const data = readJson('reading.json');
      for (const article of data.articles) {
        expect(article.category).toBeTruthy();
      }
    });
  });

  describe('profile.json', () => {
    it('parses without error', () => {
      expect(() => readJson('profile.json')).not.toThrow();
    });

    it('has name field', () => {
      const data = readJson('profile.json');
      expect(data.name).toBeTruthy();
    });

    it('has title field', () => {
      const data = readJson('profile.json');
      expect(data.title).toBeTruthy();
    });

    it('has bio field', () => {
      const data = readJson('profile.json');
      expect(data.bio).toBeTruthy();
    });

    it('has avatar field', () => {
      const data = readJson('profile.json');
      expect(data.avatar).toBeTruthy();
    });

    it('has social links (github or linkedin)', () => {
      const data = readJson('profile.json');
      const hasSocial = data.github || data.linkedin;
      expect(hasSocial).toBeTruthy();
    });
  });

  describe('github.json', () => {
    it('parses without error', () => {
      expect(() => readJson('github.json')).not.toThrow();
    });
  });

  describe('system.json', () => {
    it('parses without error', () => {
      expect(() => readJson('system.json')).not.toThrow();
    });
  });
});
