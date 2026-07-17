import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractLocs, validateAgainstXsd } from '../../scripts/audit/validate-sitemap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = (name: string) => path.join(__dirname, 'fixtures', name);
const vendorPath = (name: string) => path.join(__dirname, '..', '..', 'scripts', 'audit', 'vendor', name);

describe('extractLocs', () => {
  it('extracts every <loc> text content from a flat urlset', () => {
    const xml = '<urlset><url><loc>https://a.example/</loc></url><url><loc>https://a.example/b</loc></url></urlset>';
    expect(extractLocs(xml)).toEqual(['https://a.example/', 'https://a.example/b']);
  });

  it('returns an empty array when there are no <loc> tags', () => {
    expect(extractLocs('<urlset></urlset>')).toEqual([]);
  });
});

describe('validateAgainstXsd (real xmllint + vendored sitemaps.org 0.9 XSD)', () => {
  it('a schema-conformant urlset produces zero findings', () => {
    const findings = validateAgainstXsd(
      'sitemap-child-xsd',
      fixturePath('sitemap-valid.xml'),
      vendorPath('sitemap-0.9.xsd'),
      'https://example.com/sitemap-0.xml',
    );
    expect(findings).toEqual([]);
  });

  it('known-answer: a <priority> outside the 0.0-1.0 range fails XSD validation', () => {
    const findings = validateAgainstXsd(
      'sitemap-child-xsd',
      fixturePath('sitemap-invalid.xml'),
      vendorPath('sitemap-0.9.xsd'),
      'https://example.com/sitemap-0.xml',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('fail');
    expect(findings[0].message).toContain('sitemap-0.xml');
  });
});
