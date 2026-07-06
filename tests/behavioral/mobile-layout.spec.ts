/**
 * Mobile layout behavioral tests — system-status alignment + reading-feed
 * truncation regressions at 390px. DOM/layout assertions only (no screenshots).
 * Both bugs manifested at 390px but the assertions hold at any viewport, so they
 * run under both the desktop (1400px) and mobile (390px) behavioral projects.
 *
 * Bug 8 (system-status alignment): #systemStatus / .sys-line must compute as CSS
 *   grid (subgrid), every value cell must share the same left offset (within 1px)
 *   after hydration, and #cardSystem must not overflow. The `display: grid`
 *   assertion is the meaningful regression guard — it fails deterministically if
 *   the layout reverts to `flex` + a magic `min-width` on `.sys-key` (the old
 *   code that went ragged once a key exceeded the magic width).
 *
 * Bug 6 (reading feed): an article with an empty title + a very long source must
 *   promote the source into the title slot (never blank-left) and truncate it
 *   (ellipsis) so the row does not overrun and the "— Nd ago" date stays visible
 *   inside the card. The promoted source is NOT duplicated in a parenthetical
 *   `.article-list-source` span. Old code (`flex-shrink: 0` on the source) let the
 *   source overrun and push the date past the card edge.
 *
 * Shares the route-interception pattern from book-modal.spec.ts: all CloudFront
 * endpoints use fixtures, WebSocket and external resources are blocked.
 */
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { CLOUDFRONT_BASE, WEBSOCKET_URL } from '@lifegames/portal-contract/constants';

const require = createRequire(import.meta.url);

function baselineFixture(dir: string): string {
  return require.resolve(`@lifegames/fixtures/generated/${dir}/baseline.json`);
}

function emptyFixture(dir: string): string {
  return require.resolve(`@lifegames/fixtures/generated/${dir}/empty.json`);
}

/** Bug-6 fixture: an article with `articleTitle: ""` + an overlong `sourceTitle`. */
const READING_EMPTY_TITLE_FIXTURE = require.resolve(
  '@lifegames/fixtures/generated/articles/hoodlineEmptyTitle.json',
);

/** 1×1 transparent PNG used as a placeholder for external images. */
const TRANSPARENT_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB'
    + 'Nl7BcQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Route interception: baseline fixtures for every CloudFront endpoint, with
 * optional per-endpoint overrides (pathname → absolute fixture file).
 */
async function interceptRoutes(page: Page, overrides: Record<string, string> = {}): Promise<void> {
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const fixtureMap: Record<string, string> = {
      '/health.json': baselineFixture('health'),
      '/sleep.json': baselineFixture('sleep'),
      '/workouts.json': baselineFixture('workouts'),
      '/books.json': baselineFixture('books'),
      '/github-starred-repos.json': baselineFixture('github-starred-repos'),
      '/github-events.json': baselineFixture('github-events'),
      '/articles.json': baselineFixture('articles'),
      '/location.json': baselineFixture('location'),
      '/focus.json': emptyFixture('focus'),
      '/theatre-reviews.json': baselineFixture('theatre-reviews'),
      ...overrides,
    };
    const fixturePath = fixtureMap[url.pathname];
    if (fixturePath) {
      await route.fulfill({ path: fixturePath, contentType: 'application/json' });
    } else {
      await route.abort();
    }
  });

  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort());

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      url.startsWith('http://localhost')
      || url.startsWith('data:')
      || url.startsWith(CLOUDFRONT_BASE)
      || url.startsWith(WEBSOCKET_URL.replace('wss://', 'https://'))
      || url.startsWith('wss://')
    ) {
      await route.fallback();
      return;
    }
    if (route.request().resourceType() === 'image') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: TRANSPARENT_PIXEL });
    } else {
      await route.abort();
    }
  });
}

/** Navigate to the dashboard and wait for live-data hydration to complete. */
async function navigateAndWaitForHydration(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => document.querySelectorAll('.is-loading').length === 0, {
    timeout: 15_000,
  });
}

test.describe('Mobile layout — system-status alignment + reading-feed truncation', () => {
  test.describe.configure({ mode: 'serial' });

  // -----------------------------------------------------------------------
  // Bug 8: system-status subgrid alignment (baseline data)
  // -----------------------------------------------------------------------
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await interceptRoutes(page);
    await navigateAndWaitForHydration(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('8a. #systemStatus and .sys-line compute as CSS grid (subgrid, not flex+min-width)', async () => {
    const displays = await page.evaluate(() => {
      const ss = document.getElementById('systemStatus');
      const line = document.querySelector('#systemStatus .sys-line');
      return {
        systemStatus: ss ? getComputedStyle(ss).display : null,
        sysLine: line ? getComputedStyle(line).display : null,
      };
    });
    // Deterministic regression guard: old code was `display:flex` on .sys-line and
    // default block on #systemStatus. The subgrid fix makes both `grid`.
    expect(displays.systemStatus).toBe('grid');
    expect(displays.sysLine).toBe('grid');
  });

  test('8b. all .sys-val cells share the same left offset (within 1px)', async () => {
    const lefts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#systemStatus .sys-line > [class*="sys-val"]')).map(
        (el) => el.getBoundingClientRect().left,
      )
    );
    expect(lefts.length).toBeGreaterThan(1);
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
  });

  test('8c. #cardSystem does not overflow its container', async () => {
    const dims = await page.evaluate(() => {
      const el = document.getElementById('cardSystem');
      if (!el) return null;
      return { scrollWidth: el.scrollWidth, offsetWidth: el.offsetWidth };
    });
    expect(dims).not.toBeNull();
    expect(dims!.scrollWidth).toBeLessThanOrEqual(dims!.offsetWidth);
  });

  // -----------------------------------------------------------------------
  // Bug 6: reading feed empty-title / long-source truncation
  // -----------------------------------------------------------------------
  test('6. reading feed promotes an empty-title source into the title slot and truncates it so the date stays visible', async ({ browser }) => {
    const readingPage = await browser.newPage();
    await interceptRoutes(readingPage, { '/articles.json': READING_EMPTY_TITLE_FIXTURE });
    await navigateAndWaitForHydration(readingPage);

    const r = await readingPage.evaluate(() => {
      const card = document.getElementById('cardReading');
      const rows = document.querySelectorAll('#cardReading .article-list-item');
      const row = rows[0] ?? null;
      // The mixed fixture ends with a normal titled row; it must KEEP its source span,
      // proving the parenthetical is suppressed only for empty-title rows (not blanket).
      const titledRow = rows[rows.length - 1] ?? null;
      const title = row?.querySelector('.article-list-title') as HTMLElement | null;
      const date = row?.querySelector('.article-list-date') as HTMLElement | null;
      if (!card || !row || !title || !date || !titledRow || titledRow === row) return null;
      const cardRect = card.getBoundingClientRect();
      const dateRect = date.getBoundingClientRect();
      return {
        cardOverflow: card.scrollWidth - card.clientWidth,
        // Empty title is filled from the source, so the row never renders blank-left.
        titleText: (title.textContent ?? '').trim(),
        // The parenthetical source span must be suppressed (source not duplicated).
        hasSourceSpan: row.querySelector('.article-list-source') !== null,
        // Truncation engaged: rendered (client) width is narrower than full text.
        titleTruncated: title.scrollWidth > title.clientWidth + 1,
        dateWithinCard: dateRect.width > 0 && dateRect.right <= cardRect.right + 1,
        // Conditional-suppression control: a titled row retains its parenthetical.
        titledRowHasSource: titledRow.querySelector('.article-list-source') !== null,
      };
    });

    expect(r).not.toBeNull();
    // Empty-title rows promote the source into the title slot (never blank-left); the
    // title (flex:1 1 auto; min-width:0; ellipsis) truncates so the row fits and the
    // "— Nd ago" date stays inside the card, and the source is not duplicated in a
    // parenthetical `.article-list-source` span. A normal titled row still keeps its
    // parenthetical, so the suppression is conditional (not a blanket removal). Old
    // code (source flex-shrink:0, no ellipsis) overran the row and pushed the date
    // past the card edge.
    expect(r!.titleText).toContain('Hoodline');
    expect(r!.hasSourceSpan).toBe(false);
    expect(r!.titledRowHasSource).toBe(true);
    expect(r!.cardOverflow).toBeLessThanOrEqual(1);
    expect(r!.titleTruncated).toBe(true);
    expect(r!.dateWithinCard).toBe(true);

    await readingPage.close();
  });
});
