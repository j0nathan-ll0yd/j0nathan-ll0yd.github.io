import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { load } from 'cheerio';
import path from 'path';

// Build-tier test: asserts the compiled CSP + HTML artifacts satisfy the
// Simple Analytics reverse-proxy invariants (Issue #83).

const distDir = path.resolve(process.cwd(), 'dist');

let $: ReturnType<typeof load>;
let middlewareSrc: string;

beforeAll(() => {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf-8');
  $ = load(html);
  // Read the middleware source to inspect the CSP string
  middlewareSrc = readFileSync(
    path.resolve(process.cwd(), 'functions/_middleware.ts'),
    'utf-8',
  );
});

describe('Simple Analytics reverse-proxy CSP assertions', () => {
  it('CSP string contains no simpleanalyticscdn.com reference', () => {
    expect(middlewareSrc).not.toContain('simpleanalyticscdn');
  });

  it('noscript pixel uses the first-party /simple/noscript.gif path', () => {
    const noscriptImg = $('noscript img').attr('src');
    // The noscript block is only rendered in PROD; in a test build it may be absent.
    // If present, assert it is first-party.
    if (noscriptImg !== undefined) {
      expect(noscriptImg).toBe('/simple/noscript.gif');
      expect(noscriptImg).not.toContain('simpleanalyticscdn');
    }
  });

  it('no dns-prefetch hints to simpleanalyticscdn.com remain in the HTML', () => {
    const prefetchLinks = $('link[rel="dns-prefetch"]');
    prefetchLinks.each((_i, el) => {
      const href = $(el).attr('href') ?? '';
      expect(href).not.toContain('simpleanalyticscdn');
    });
  });

  it('sa-loader.js loads the first-party /sa route and not simpleanalyticscdn.com', () => {
    const loaderSrc = readFileSync(
      path.resolve(process.cwd(), 'public/js/sa-loader.js'),
      'utf-8',
    );
    // Cloudflare Pages serves functions/sa.ts at the route /sa (the .ts extension
    // is stripped), so the loader must request /sa, NOT /sa.js (which 404s).
    expect(loaderSrc).toContain("s.src = '/sa'");
    expect(loaderSrc).not.toContain('/sa.js');
    expect(loaderSrc).not.toContain('simpleanalyticscdn');
  });
});
