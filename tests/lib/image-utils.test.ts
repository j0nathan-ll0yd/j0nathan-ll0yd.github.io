import { describe, it, expect } from 'vitest';
import { localizeImageUrl, imgFallbackAttrs } from '../../src/lib/image-utils';

const CF_PREFIX = 'https://d2nfgi9u0n3jr6.cloudfront.net/images/';

describe('localizeImageUrl', () => {
  it('converts a CloudFront URL to a local /images/ path', () => {
    const url = CF_PREFIX + 'books/B01234.webp';
    expect(localizeImageUrl(url)).toBe('/images/books/B01234.webp');
  });

  it('converts nested CloudFront path', () => {
    const url = CF_PREFIX + 'theatre/my-show-slug.webp';
    expect(localizeImageUrl(url)).toBe('/images/theatre/my-show-slug.webp');
  });

  it('passes through non-CloudFront URLs unchanged', () => {
    const amazon = 'https://m.media-amazon.com/images/P/B0001234.jpg';
    expect(localizeImageUrl(amazon)).toBe(amazon);
  });

  it('passes through a Squarespace URL unchanged', () => {
    const sq = 'https://images.squarespace-cdn.com/content/image.jpg';
    expect(localizeImageUrl(sq)).toBe(sq);
  });

  it('returns null for null input', () => {
    expect(localizeImageUrl(null)).toBeNull();
  });

  it('returns empty string for empty string input', () => {
    expect(localizeImageUrl('')).toBe('');
  });

  it('does not double-convert an already-local path', () => {
    const local = '/images/books/B01234.webp';
    expect(localizeImageUrl(local)).toBe(local);
  });
});

describe('imgFallbackAttrs', () => {
  it('returns onerror attribute when both src and originalUrl differ', () => {
    const local = '/images/books/B0001234.webp';
    const original = CF_PREFIX + 'books/B0001234.webp';
    const result = imgFallbackAttrs(local, original);
    expect(result).toContain('onerror=');
    expect(result).toContain(`data-fallback="${original}"`);
  });

  it('returns empty string when originalUrl is null', () => {
    expect(imgFallbackAttrs('/images/foo.webp', null)).toBe('');
  });

  it('returns empty string when localSrc is null', () => {
    expect(imgFallbackAttrs(null, CF_PREFIX + 'foo.webp')).toBe('');
  });

  it('returns empty string when localSrc === originalUrl (same src, no fallback needed)', () => {
    const url = 'https://example.com/img.jpg';
    expect(imgFallbackAttrs(url, url)).toBe('');
  });

  it('onerror sets this.onerror=null to prevent infinite loops', () => {
    const result = imgFallbackAttrs('/images/foo.webp', CF_PREFIX + 'foo.webp');
    expect(result).toContain('this.onerror=null');
  });

  it('onerror clears srcset before swapping src', () => {
    const result = imgFallbackAttrs('/images/foo.webp', CF_PREFIX + 'foo.webp');
    expect(result).toContain("this.srcset=''");
  });

  it('result starts with a space (for safe HTML attribute concatenation)', () => {
    const result = imgFallbackAttrs('/images/foo.webp', CF_PREFIX + 'foo.webp');
    expect(result.startsWith(' ')).toBe(true);
  });
});
