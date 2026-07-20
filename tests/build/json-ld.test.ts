import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { load } from 'cheerio';
import path from 'path';
import { SITE_URL, DATASET_VARIABLES, DATASET_DISTRIBUTIONS } from '@lifegames/portal-contract/constants';

const distDir = path.resolve(process.cwd(), 'dist');

/** Parse the single JSON-LD @graph emitted by a built HTML page. */
function loadGraph(relPath: string): any[] {
  const html = readFileSync(path.join(distDir, relPath), 'utf-8');
  const $ = load(html);
  const scriptContent = $('script[type="application/ld+json"]').html();
  expect(scriptContent, `${relPath} must emit a JSON-LD block`).toBeTruthy();
  const parsed = JSON.parse(scriptContent!);
  return parsed['@graph'];
}

/**
 * Collect every `@id` that some node in the graph DEFINES (a node object that
 * carries both `@type` and `@id`) and every `@id` that is REFERENCED (any nested
 * object whose only meaningful key is `@id`, e.g. `mainEntity`, `publisher`,
 * `isPartOf`, `creator`). A reference is dangling if it names an `@id` no node
 * defines on the same page.
 */
function collectIds(graph: any[]): { defined: Set<string>; referenced: Set<string>; } {
  const defined = new Set<string>();
  const referenced = new Set<string>();
  const walk = (value: any, isTopLevelNode: boolean) => {
    if (Array.isArray(value)) {
      value.forEach((v) => walk(v, false));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value['@id'] === 'string') {
      if (isTopLevelNode && value['@type']) {
        defined.add(value['@id']);
      } else {
        // A bare `{ "@id": ... }` (no `@type`) is a cross-reference to another node.
        referenced.add(value['@id']);
      }
    }
    for (const [key, v] of Object.entries(value)) {
      if (key === '@id' || key === '@type') continue;
      walk(v, false);
    }
  };
  graph.forEach((node) => walk(node, true));
  return { defined, referenced };
}

let graph: any[];

beforeAll(() => {
  graph = loadGraph('index.html');
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

  it('license points at the privacy page, not the bare site root', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset');
    expect(dataset.license).toBe(SITE_URL + '/privacy');
  });
});

// Regression guard for the /privacy + /404 bug: Dashboard.astro is the shared
// layout for every page, and it once emitted ProfilePage + Dataset on all of
// them (labelling the privacy policy as a person's profile page). These assert
// the per-page @graph is internally consistent and that person-scoped nodes are
// gated to the home page.
describe('JSON-LD @graph per-page shape and @id resolution', () => {
  const pages = [
    { label: 'home', file: 'index.html', isHome: true },
    { label: 'privacy', file: 'privacy/index.html', isHome: false },
    { label: '404', file: '404.html', isHome: false },
  ];

  for (const page of pages) {
    describe(`${page.label} (${page.file})`, () => {
      let pageGraph: any[];
      beforeAll(() => {
        pageGraph = loadGraph(page.file);
      });

      it('parses as a non-empty JSON @graph array', () => {
        expect(Array.isArray(pageGraph)).toBe(true);
        expect(pageGraph.length).toBeGreaterThan(0);
      });

      it('has no dangling @id references (every reference resolves to a defined node)', () => {
        const { defined, referenced } = collectIds(pageGraph);
        const dangling = [...referenced].filter((id) => !defined.has(id));
        expect(dangling, `dangling @id references on ${page.file}`).toEqual([]);
      });

      it('always carries a WebSite and a Person node', () => {
        expect(pageGraph.some((n) => n['@type'] === 'WebSite')).toBe(true);
        expect(pageGraph.some((n) => n['@type'] === 'Person')).toBe(true);
      });

      if (page.isHome) {
        it('home page defines ProfilePage and Dataset', () => {
          expect(pageGraph.some((n) => n['@type'] === 'ProfilePage')).toBe(true);
          expect(pageGraph.some((n) => n['@type'] === 'Dataset')).toBe(true);
        });

        it('home page does NOT emit a WebPage node', () => {
          expect(pageGraph.some((n) => n['@type'] === 'WebPage')).toBe(false);
        });
      } else {
        it('non-home page does NOT emit ProfilePage or Dataset', () => {
          expect(pageGraph.some((n) => n['@type'] === 'ProfilePage')).toBe(false);
          expect(pageGraph.some((n) => n['@type'] === 'Dataset')).toBe(false);
        });

        it('non-home page emits a WebPage node that isPartOf the WebSite', () => {
          const webpage = pageGraph.find((n) => n['@type'] === 'WebPage');
          expect(webpage).toBeDefined();
          expect(webpage.isPartOf['@id']).toBe(SITE_URL + '#website');
          expect(webpage.name).toBeTruthy();
        });
      }
    });
  }
});
