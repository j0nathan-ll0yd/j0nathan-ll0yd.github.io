/**
 * BookModal behavioral tests — interaction assertions against the native <dialog>.
 *
 * Asserts DOM/interaction behavior only (no screenshots). Uses the production
 * build with CloudFront route interception so the Bookshelf is deterministically
 * populated from the "full" books fixture, which provides:
 *   - reading:  "Shorefall" (B07QVH2Q2K, 63% progress)
 *   - finished: "The Tainted Cup" (1984820710, finishedAt + notes)
 *   - upNext:   "Crafting Engineering Strategy" (B0FBRJY116, no progress/notes)
 *
 * Plan §5 acceptance criteria: open, status-fields, single-fire analytics,
 * Escape, backdrop-click, close-button, focus-restore, focus-containment (inert),
 * CSP onerror-fix.
 */
import { createRequire } from 'node:module';
import { test, expect, type Page } from '@playwright/test';
import { CLOUDFRONT_BASE, WEBSOCKET_URL } from '@lifegames/portal-contract/constants';

const require = createRequire(import.meta.url);

// Resolve the "full" books fixture via the @lifegames/fixtures package exports
// map. This fixture has reading+finished+upNext books with all fields populated.
const BOOKS_FULL_FIXTURE: string = require.resolve(
  '@lifegames/fixtures/generated/books/full.json',
);

// Other endpoints use baseline fixtures (unchanged from visual suite).
function baselineFixture(dir: string, file: string): string {
  const camelFile = file.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return require.resolve(`@lifegames/fixtures/generated/${dir}/${camelFile}.json`);
}

/** Set up route interception: books→full, everything else→baseline or block */
async function interceptRoutes(page: Page): Promise<void> {
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const fixtureMap: Record<string, string> = {
      '/books.json': BOOKS_FULL_FIXTURE,
      '/health.json': baselineFixture('health', 'baseline'),
      '/sleep.json': baselineFixture('sleep', 'baseline'),
      '/workouts.json': baselineFixture('workouts', 'baseline'),
      '/github-starred-repos.json': baselineFixture('github-starred-repos', 'baseline'),
      '/github-events.json': baselineFixture('github-events', 'baseline'),
      '/articles.json': baselineFixture('articles', 'baseline'),
      '/location.json': baselineFixture('location', 'baseline'),
      '/focus.json': baselineFixture('focus', 'empty'),
      '/theatre-reviews.json': baselineFixture('theatre-reviews', 'baseline'),
    };
    const fixturePath = fixtureMap[url.pathname];
    if (fixturePath) {
      await route.fulfill({ path: fixturePath, contentType: 'application/json' });
    } else {
      await route.abort();
    }
  });

  // Block WebSocket
  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort());

  // Serve transparent pixel for external images; abort everything else
  const TRANSPARENT_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
      'Nl7BcQAAAABJRU5ErkJggg==',
    'base64',
  );
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      url.startsWith('http://localhost') ||
      url.startsWith('data:') ||
      url.startsWith(CLOUDFRONT_BASE) ||
      url.startsWith(WEBSOCKET_URL.replace('wss://', 'https://')) ||
      url.startsWith('wss://')
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

/**
 * Navigate to the dashboard and wait for the bookshelf to be populated.
 * Stubs window.sa_event before page load so it is always present.
 */
async function navigateWithSaStub(page: Page): Promise<void> {
  // Inject the sa_event stub before any script runs, so both the bundled DS
  // runtime and (if present) any other script see the same stub.
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>)['_saEventCalls'] = [] as string[];
    (window as unknown as Record<string, unknown>)['sa_event'] = (
      name: string,
      props?: Record<string, unknown>,
    ) => {
      ((window as unknown as Record<string, unknown>)['_saEventCalls'] as string[]).push(name);
      console.log('[sa_stub] sa_event:', name, props);
    };
  });

  await page.goto('/');

  // Wait for skeleton states to clear — the bookshelf is populated
  await page.waitForFunction(
    () => document.querySelectorAll('.is-loading').length === 0,
    { timeout: 15_000 },
  );

  // Ensure #cardBooks has at least one clickable shelf-book
  await page.waitForSelector('#cardBooks .shelf-book[data-book]', { timeout: 10_000 });
}

/**
 * Click the first .shelf-book[data-book] in #cardBooks that matches the given ASIN.
 * Returns the trigger element locator.
 */
async function clickBookByAsin(page: Page, asin: string): Promise<void> {
  const trigger = page.locator(`#cardBooks .shelf-book[data-book*="${asin}"]`).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('BookModal — native <dialog> behavior', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await interceptRoutes(page);
    await navigateWithSaStub(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // Helper: close the dialog if it's open between tests
  test.afterEach(async () => {
    const isOpen = await page.evaluate(() => {
      const d = document.getElementById('bookDialog') as HTMLDialogElement | null;
      return d ? d.open : false;
    });
    if (isOpen) {
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => !(document.getElementById('bookDialog') as HTMLDialogElement)?.open,
        { timeout: 3000 },
      );
    }
  });

  // -----------------------------------------------------------------------
  // 1. Open: dialog gets [open] + :modal, title visible
  // -----------------------------------------------------------------------
  test('1. clicking a shelf-book opens dialog#bookDialog with [open]', async () => {
    // reading book: Shorefall (B07QVH2Q2K)
    await clickBookByAsin(page, 'B07QVH2Q2K');
    const dialog = page.locator('dialog#bookDialog');
    await expect(dialog).toHaveAttribute('open');
    // Native <dialog> showModal → matches :modal (confirmed via evaluate)
    const isModal = await page.evaluate(() => {
      const d = document.getElementById('bookDialog') as HTMLDialogElement | null;
      return d ? d.matches(':modal') : false;
    });
    expect(isModal).toBe(true);
    // Title is visible
    await expect(page.locator('.book-modal-title')).toContainText('Shorefall');
  });

  // -----------------------------------------------------------------------
  // 1b. Status-dependent fields — reading book (progress bar)
  // -----------------------------------------------------------------------
  test('1b-reading. reading book shows .book-modal-progress-fill with a width', async () => {
    await clickBookByAsin(page, 'B07QVH2Q2K');
    const progressFill = page.locator('.book-modal-progress-fill');
    await expect(progressFill).toBeVisible();
    const width = await progressFill.evaluate((el) => (el as HTMLElement).style.width);
    expect(width).toBeTruthy();
    expect(width).not.toBe('0%');
  });

  // -----------------------------------------------------------------------
  // 1b. Status-dependent fields — finished book (finishedAt + notes)
  // -----------------------------------------------------------------------
  test('1b-finished. finished book shows .book-modal-finished-date and .book-modal-notes', async () => {
    // The Tainted Cup — finished with finishedAt + notes
    await clickBookByAsin(page, '1984820710');
    await expect(page.locator('.book-modal-title')).toContainText('The Tainted Cup');
    await expect(page.locator('.book-modal-finished-date')).toBeVisible();
    await expect(page.locator('.book-modal-notes')).toBeVisible();
    // Progress bar must NOT appear for a finished book
    await expect(page.locator('.book-modal-progress-fill')).toHaveCount(0);
  });

  // -----------------------------------------------------------------------
  // 1b. Status-dependent fields — upNext book (no progress, no notes)
  // -----------------------------------------------------------------------
  test('1b-upNext. upNext book shows neither progress fill nor notes', async () => {
    // Crafting Engineering Strategy — upNext
    await clickBookByAsin(page, 'B0FBRJY116');
    await expect(page.locator('.book-modal-title')).toContainText('Crafting Engineering Strategy');
    await expect(page.locator('.book-modal-progress-fill')).toHaveCount(0);
    await expect(page.locator('.book-modal-notes')).toHaveCount(0);
  });

  // -----------------------------------------------------------------------
  // 2. Single-fire: sa_event('book_open') fires exactly once per open
  // -----------------------------------------------------------------------
  test('2. sa_event("book_open") fires exactly once per open (no double-init)', async () => {
    // Reset the call log
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown[]>)['_saEventCalls'] = [];
    });

    await clickBookByAsin(page, 'B07QVH2Q2K');
    await expect(page.locator('dialog#bookDialog')).toHaveAttribute('open');

    const calls = await page.evaluate(
      () => (window as unknown as Record<string, unknown>)['_saEventCalls'] as string[],
    );
    expect(calls.filter((c) => c === 'book_open')).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 3. Escape closes the dialog
  // -----------------------------------------------------------------------
  test('3. pressing Escape closes the dialog', async () => {
    await clickBookByAsin(page, 'B07QVH2Q2K');
    await expect(page.locator('dialog#bookDialog')).toHaveAttribute('open');

    await page.keyboard.press('Escape');

    await expect(page.locator('dialog#bookDialog')).not.toHaveAttribute('open');
  });

  // -----------------------------------------------------------------------
  // 4a. Backdrop click closes the dialog
  // -----------------------------------------------------------------------
  test('4a. clicking outside dialog box bounds (backdrop) closes it', async () => {
    await clickBookByAsin(page, 'B07QVH2Q2K');
    const dialog = page.locator('dialog#bookDialog');
    await expect(dialog).toHaveAttribute('open');

    // Get dialog bounding box and click outside (top-left corner of viewport)
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    // Click at (1, 1) — outside the dialog box (dialog is centered)
    await page.mouse.click(1, 1);

    await expect(dialog).not.toHaveAttribute('open');
  });

  // -----------------------------------------------------------------------
  // 4b. Click inside the modal does NOT close it
  // -----------------------------------------------------------------------
  test('4b. clicking inside the dialog box does not close it', async () => {
    await clickBookByAsin(page, 'B07QVH2Q2K');
    const dialog = page.locator('dialog#bookDialog');
    await expect(dialog).toHaveAttribute('open');

    // Click the title (inside dialog) — should not close
    await page.locator('.book-modal-title').click();

    await expect(dialog).toHaveAttribute('open');
  });

  // -----------------------------------------------------------------------
  // 5. Close button closes the dialog
  // -----------------------------------------------------------------------
  test('5. clicking .book-modal-close closes the dialog', async () => {
    await clickBookByAsin(page, 'B07QVH2Q2K');
    const dialog = page.locator('dialog#bookDialog');
    await expect(dialog).toHaveAttribute('open');

    await page.locator('.book-modal-close').click();

    await expect(dialog).not.toHaveAttribute('open');
  });

  // -----------------------------------------------------------------------
  // 6. Focus restore: after close, focus returns to the trigger
  // -----------------------------------------------------------------------
  test('6. closing modal returns focus to the originating shelf-book trigger', async () => {
    const trigger = page.locator('#cardBooks .shelf-book[data-book*="B07QVH2Q2K"]').first();
    await trigger.click();
    await expect(page.locator('dialog#bookDialog')).toHaveAttribute('open');

    await page.locator('.book-modal-close').click();
    await expect(page.locator('dialog#bookDialog')).not.toHaveAttribute('open');

    const isFocused = await page.evaluate(() => {
      const trigger = document.querySelector(
        '#cardBooks .shelf-book[data-book*="B07QVH2Q2K"]',
      ) as HTMLElement | null;
      return document.activeElement === trigger;
    });
    expect(isFocused).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 7. Focus containment: dialog is :modal → background is inert
  // -----------------------------------------------------------------------
  test('7. while dialog is open, background #main-content is not focusable (dialog :modal)', async () => {
    await clickBookByAsin(page, 'B07QVH2Q2K');
    await expect(page.locator('dialog#bookDialog')).toHaveAttribute('open');

    // Confirm :modal (background inert via showModal)
    const isModal = await page.evaluate(() => {
      const d = document.getElementById('bookDialog') as HTMLDialogElement | null;
      return d ? d.matches(':modal') : false;
    });
    expect(isModal).toBe(true);

    // Try to focus an element outside the dialog — should fail (inert background)
    const canFocusBehind = await page.evaluate(() => {
      // Find any focusable element in #main-content
      const mc = document.getElementById('main-content');
      if (!mc) return false;
      const focusable = mc.querySelector<HTMLElement>(
        'a[href], button, input, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable) return false;
      focusable.focus();
      return document.activeElement === focusable;
    });
    expect(canFocusBehind).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 8. CSP onerror fix: .book-modal-cover must NOT have an onerror= attribute
  // -----------------------------------------------------------------------
  test('8. .book-modal-cover outerHTML contains no onerror= attribute (D3 CSP fix)', async () => {
    await clickBookByAsin(page, 'B07QVH2Q2K');
    await expect(page.locator('dialog#bookDialog')).toHaveAttribute('open');

    const outerHtml = await page.locator('.book-modal-cover').first().evaluate((el) => el.outerHTML);
    expect(outerHtml).not.toContain('onerror=');
  });
});
