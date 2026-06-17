import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist');
const humansTxtPath = path.join(distDir, 'humans.txt');

let content: string;

beforeAll(() => {
  content = readFileSync(humansTxtPath, 'utf-8');
});

describe('humans.txt build output', () => {
  it('dist/humans.txt exists and is non-empty', () => {
    expect(existsSync(humansTxtPath)).toBe(true);
    expect(content.length).toBeGreaterThan(0);
  });

  it('contains /* TEAM */ section header', () => {
    expect(content).toContain('/* TEAM */');
  });

  it('contains /* SITE */ section header', () => {
    expect(content).toContain('/* SITE */');
  });

  it('contains /* THANKS */ section header', () => {
    expect(content).toContain('/* THANKS */');
  });

  it('contains Name: Jonathan Lloyd', () => {
    expect(content).toContain('Name: Jonathan Lloyd');
  });

  it('contains no @ character (email privacy guard)', () => {
    expect(content).not.toContain('@');
  });
});
