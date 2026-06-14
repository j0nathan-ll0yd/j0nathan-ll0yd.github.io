import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { load } from 'cheerio';
import path from 'path';
import { SITE_URL, DATASET_VARIABLES, DATASET_DISTRIBUTIONS } from '@lifegames/portal-contract/constants';

const distDir = path.resolve(process.cwd(), 'dist');

let graph: any[];

beforeAll(() => {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf-8');
  const $ = load(html);
  const scriptContent = $('script[type="application/ld+json"]').html();
  expect(scriptContent).toBeTruthy();
  const parsed = JSON.parse(scriptContent!);
  graph = parsed['@graph'];
});

describe('JSON-LD Structured Data', () => {
  it('parses as valid JSON', () => {
    expect(graph).toBeDefined();
    expect(Array.isArray(graph)).toBe(true);
  });

  it('contains a WebSite node', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite');
    expect(website).toBeDefined();
  });

  it('WebSite has correct url', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite');
    expect(website.url).toBe(SITE_URL);
  });

  it('WebSite has name', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite');
    expect(website.name).toBeTruthy();
    expect(website.name).toContain('Jonathan Lloyd');
  });

  it('contains a Person node', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person');
    expect(person).toBeDefined();
  });

  it('Person has name "Jonathan Lloyd"', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person');
    expect(person.name).toBe('Jonathan Lloyd');
  });

  it('Person has jobTitle', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person');
    expect(person.jobTitle).toBeTruthy();
  });

  it('Person has description', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person');
    expect(person.description).toBeTruthy();
    expect(person.description.length).toBeGreaterThan(0);
  });

  it('Person has knowsAbout array', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person');
    expect(Array.isArray(person.knowsAbout)).toBe(true);
    expect(person.knowsAbout.length).toBeGreaterThan(0);
  });

  it('Person has sameAs array with social links', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person');
    expect(Array.isArray(person.sameAs)).toBe(true);
    expect(person.sameAs.length).toBeGreaterThan(0);
  });

  it('all urls use the canonical site URL', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite');
    const person = graph.find((n: any) => n['@type'] === 'Person');
    expect(website.url).toMatch(SITE_URL);
    expect(person.url).toMatch(SITE_URL);
  });
});

describe('JSON-LD Dataset (sourced from @lifegames/portal-contract)', () => {
  it('contains a Dataset node', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset');
    expect(dataset).toBeDefined();
  });

  it('variableMeasured equals DATASET_VARIABLES exactly (ordered)', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset');
    expect(dataset.variableMeasured).toEqual([...DATASET_VARIABLES]);
  });

  it('distribution equals DATASET_DISTRIBUTIONS exactly (ordered, DataDownload shape)', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset');
    const expected = DATASET_DISTRIBUTIONS.map((d) => ({
      '@type': 'DataDownload',
      name: d.name,
      encodingFormat: d.encodingFormat,
      contentUrl: d.contentUrl,
    }));
    expect(dataset.distribution).toEqual(expected);
  });
});
