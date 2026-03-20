/**
 * Widget-level visual regression tests.
 *
 * 4a: Baseline screenshot of each widget in the populated scenario.
 * 4b: Per-widget variation screenshots (each test uses its own scenario).
 * 4c: Overlay tests (focus-work, focus-dnd).
 */
import { test, expect } from '@playwright/test';
import { setupPage, stylePath, WIDGET_SELECTORS } from './helpers';

// ---------------------------------------------------------------------------
// 4a: Baseline Widget Screenshots (populated scenario)
// ---------------------------------------------------------------------------

test.describe('Widgets - populated', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'populated');
  });

  test('identity card', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.identityCard);
    await expect(widget).toHaveScreenshot('widget-identity-card.png', { stylePath });
  });

  test('bio terminal', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.bioTerminal);
    await expect(widget).toHaveScreenshot('widget-bio-terminal.png', { stylePath });
  });

  test('system status', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.systemStatus);
    await expect(widget).toHaveScreenshot('widget-system-status.png', { stylePath });
  });

  test('heart rate', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.heartRate);
    await expect(widget).toHaveScreenshot('widget-heart-rate.png', { stylePath });
  });

  test('daily activity', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.dailyActivity);
    await expect(widget).toHaveScreenshot('widget-daily-activity.png', { stylePath });
  });

  test('workouts', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.workouts);
    await expect(widget).toHaveScreenshot('widget-workouts.png', { stylePath });
  });

  test('hydration', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.hydration);
    await expect(widget).toHaveScreenshot('widget-hydration.png', { stylePath });
  });

  test('night summary', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.nightSummary);
    await expect(widget).toHaveScreenshot('widget-night-summary.png', { stylePath });
  });

  test('dev activity log', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.devActivityLog);
    await expect(widget).toHaveScreenshot('widget-dev-activity-log.png', { stylePath });
  });

  test('reading feed', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.readingFeed);
    await expect(widget).toHaveScreenshot('widget-reading-feed.png', { stylePath });
  });

  test('bookshelf', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.bookshelf);
    await expect(widget).toHaveScreenshot('widget-bookshelf.png', { stylePath });
  });

  test('theatre reviews', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.theatreReviews);
    await expect(widget).toHaveScreenshot('widget-theatre-reviews.png', { stylePath });
  });

  test('top bar', async ({ page }) => {
    const widget = page.locator(WIDGET_SELECTORS.topBar);
    await expect(widget).toHaveScreenshot('widget-top-bar.png', { stylePath });
  });
});

// ---------------------------------------------------------------------------
// 4b: Widget Variation Screenshots
// ---------------------------------------------------------------------------

test.describe('Widget variations - Heart Rate', () => {
  test('bradycardia', async ({ page }) => {
    await setupPage(page, 'hr-bradycardia');
    const widget = page.locator('#cardHR');
    await expect(widget).toHaveScreenshot('hr-bradycardia.png', { stylePath });
  });

  test('peak', async ({ page }) => {
    await setupPage(page, 'hr-peak');
    const widget = page.locator('#cardHR');
    await expect(widget).toHaveScreenshot('hr-peak.png', { stylePath });
  });

  test('resting', async ({ page }) => {
    await setupPage(page, 'hr-resting');
    const widget = page.locator('#cardHR');
    await expect(widget).toHaveScreenshot('hr-resting.png', { stylePath });
  });
});

test.describe('Widget variations - Hydration', () => {
  test('zero', async ({ page }) => {
    await setupPage(page, 'hydration-zero');
    const widget = page.locator('#cardHydration');
    await expect(widget).toHaveScreenshot('hydration-zero.png', { stylePath });
  });

  test('max', async ({ page }) => {
    await setupPage(page, 'hydration-max');
    const widget = page.locator('#cardHydration');
    await expect(widget).toHaveScreenshot('hydration-max.png', { stylePath });
  });
});

test.describe('Widget variations - Night Summary', () => {
  test('deep dominant', async ({ page }) => {
    await setupPage(page, 'sleep-deep-dominant');
    const widget = page.locator('#cardSleep');
    await expect(widget).toHaveScreenshot('sleep-deep-dominant.png', { stylePath });
  });

  test('rem dominant', async ({ page }) => {
    await setupPage(page, 'sleep-rem-dominant');
    const widget = page.locator('#cardSleep');
    await expect(widget).toHaveScreenshot('sleep-rem-dominant.png', { stylePath });
  });

  test('short sleep', async ({ page }) => {
    await setupPage(page, 'sleep-short');
    const widget = page.locator('#cardSleep');
    await expect(widget).toHaveScreenshot('sleep-short.png', { stylePath });
  });
});

test.describe('Widget variations - Bookshelf', () => {
  test('all reading', async ({ page }) => {
    await setupPage(page, 'books-all-reading');
    const widget = page.locator('#cardBooks');
    await expect(widget).toHaveScreenshot('books-all-reading.png', { stylePath });
  });

  test('all completed', async ({ page }) => {
    await setupPage(page, 'books-all-completed');
    const widget = page.locator('#cardBooks');
    await expect(widget).toHaveScreenshot('books-all-completed.png', { stylePath });
  });

  test('no covers', async ({ page }) => {
    await setupPage(page, 'books-no-covers');
    const widget = page.locator('#cardBooks');
    await expect(widget).toHaveScreenshot('books-no-covers.png', { stylePath });
  });
});

test.describe('Widget variations - Dev Activity Log', () => {
  test('commits only', async ({ page }) => {
    await setupPage(page, 'github-commits-only');
    const widget = page.locator('#cardDevLog');
    await expect(widget).toHaveScreenshot('github-commits-only.png', { stylePath });
  });

  test('prs only', async ({ page }) => {
    await setupPage(page, 'github-prs-only');
    const widget = page.locator('#cardDevLog');
    await expect(widget).toHaveScreenshot('github-prs-only.png', { stylePath });
  });
});

test.describe('Widget variations - Workouts', () => {
  test('multi workout', async ({ page }) => {
    await setupPage(page, 'workouts-multi');
    const workouts = page.locator('#cardWorkouts');
    await expect(workouts).toBeVisible();
    await expect(workouts).toHaveScreenshot('workouts-multi.png', { stylePath });
  });

  test('barrys bootcamp', async ({ page }) => {
    await setupPage(page, 'workouts-barrys');
    const workouts = page.locator('#cardWorkouts');
    await expect(workouts).toBeVisible();
    await expect(workouts).toHaveScreenshot('workouts-barrys.png', { stylePath });
  });
});

test.describe('Widget variations - Theatre Reviews', () => {
  test('all grades', async ({ page }) => {
    await setupPage(page, 'theatre-all-grades');
    const widget = page.locator('#cardTheatreReviews');
    await expect(widget).toHaveScreenshot('theatre-all-grades.png', { stylePath });
  });

  test('no images', async ({ page }) => {
    await setupPage(page, 'theatre-no-images');
    const widget = page.locator('#cardTheatreReviews');
    await expect(widget).toHaveScreenshot('theatre-no-images.png', { stylePath });
  });
});

// ---------------------------------------------------------------------------
// 4c: Overlay Tests
// ---------------------------------------------------------------------------

test.describe('Overlays', () => {
  test('focus overlay', async ({ page }) => {
    await setupPage(page, 'focus-work');
    await page.locator('#focusOverlay').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page).toHaveScreenshot('focus-overlay.png', { fullPage: true, stylePath });
  });

  test('dnd overlay', async ({ page }) => {
    await setupPage(page, 'focus-dnd');
    await page.locator('#dndOverlay').waitFor({ state: 'visible', timeout: 10000 });
    await expect(page).toHaveScreenshot('dnd-overlay.png', { fullPage: true, stylePath });
  });
});
