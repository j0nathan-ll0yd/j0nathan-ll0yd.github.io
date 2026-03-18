import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { load } from 'cheerio';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist');

let $: ReturnType<typeof load>;

beforeAll(() => {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf-8');
  $ = load(html);
});

describe('SEO Meta Tags', () => {
  it('title contains "Jonathan Lloyd"', () => {
    const title = $('title').text();
    expect(title).toContain('Jonathan Lloyd');
  });

  it('meta description is non-empty', () => {
    const desc = $('meta[name="description"]').attr('content');
    expect(desc).toBeTruthy();
    expect(desc!.length).toBeGreaterThan(0);
  });

  it('meta description contains "data dashboard"', () => {
    const desc = $('meta[name="description"]').attr('content');
    expect(desc).toContain('data dashboard');
  });

  it('og:type is "profile"', () => {
    const ogType = $('meta[property="og:type"]').attr('content');
    expect(ogType).toBe('profile');
  });

  it('og:title is present and non-empty', () => {
    const ogTitle = $('meta[property="og:title"]').attr('content');
    expect(ogTitle).toBeTruthy();
    expect(ogTitle!.length).toBeGreaterThan(0);
  });

  it('og:description is present and non-empty', () => {
    const ogDesc = $('meta[property="og:description"]').attr('content');
    expect(ogDesc).toBeTruthy();
    expect(ogDesc!.length).toBeGreaterThan(0);
  });

  it('og:image is present and non-empty', () => {
    const ogImage = $('meta[property="og:image"]').attr('content');
    expect(ogImage).toBeTruthy();
    expect(ogImage!.length).toBeGreaterThan(0);
  });

  it('profile:first_name is "Jonathan"', () => {
    const firstName = $('meta[property="profile:first_name"]').attr('content');
    expect(firstName).toBe('Jonathan');
  });

  it('profile:last_name is "Lloyd"', () => {
    const lastName = $('meta[property="profile:last_name"]').attr('content');
    expect(lastName).toBe('Lloyd');
  });

  it('twitter:card is present', () => {
    const twitterCard = $('meta[name="twitter:card"]').attr('content');
    expect(twitterCard).toBeTruthy();
  });

  it('canonical link is present and uses https://jonathanlloyd.me', () => {
    const canonical = $('link[rel="canonical"]').attr('href');
    expect(canonical).toBeTruthy();
    expect(canonical).toContain('jonathanlloyd.me');
  });

  it('sitemap link is present', () => {
    const sitemap = $('link[rel="sitemap"]').attr('href');
    expect(sitemap).toBeTruthy();
  });

  it('no duplicate title tags', () => {
    const titles = $('title');
    expect(titles.length).toBe(1);
  });

  it('og:url is present', () => {
    const ogUrl = $('meta[property="og:url"]').attr('content');
    expect(ogUrl).toBeTruthy();
  });

  it('meta author is present', () => {
    const author = $('meta[name="author"]').attr('content');
    expect(author).toBeTruthy();
  });
});
