/**
 * Widget-level visual regression tests.
 *
 * 4a: Baseline screenshot of each widget in the populated scenario.
 * 4b: Per-widget variation screenshots (each test uses its own scenario).
 * 4c: Overlay tests (focus-work, focus-dnd).
 */
import { test, expect, type Page } from './pw-fixtures';
import {
  setupPage,
  stylePath,
  WIDGET_SELECTORS,
  captureFullPage,
  stabilizeForLocatorScreenshot,
  waitForStableBox,
} from './helpers';

// ---------------------------------------------------------------------------
// 4a: Baseline Widget Screenshots (populated scenario)
//
// All 14 populated-widget tests share a single page navigation per worker.
// Without sharing, beforeEach re-navigates 14 times per project × 4 projects =
// 56 redundant page loads. Tests are pure screenshots (no DOM mutation), so
// reusing the page is safe. Serial mode is required for shared-page pattern.
// ---------------------------------------------------------------------------

test.describe('Widgets - populated', () => {
  test.describe.configure({ mode: 'serial' });

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // waitForScrollHeight also gates the bio-terminal typewriter wait. The
    // bio-terminal widget screenshot below requires the typewriter to have
    // completed (or been forced visible via the fallback).
    await setupPage(page, 'populated', { waitForScrollHeight: true });
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('identity card', async () => {
    const widget = page.locator(WIDGET_SELECTORS.identityCard);
    await expect(widget).toHaveScreenshot('widget-identity-card.png', { stylePath });
  });

  test('bio terminal', async () => {
    const widget = page.locator(WIDGET_SELECTORS.bioTerminal);

    // Behavioral guard (non-screenshot, planning-protocol visual-state rule): the
    // interests command is the accurate `ls -m interests/` (not the old, broken
    // `wc -l interests/`), and the listing is alphabetical. Asserted on the SSR
    // data-* attributes so it holds independent of the typewriter + pixel baseline.
    const body = page.locator('#terminalBody');
    await expect(body.locator('[data-cmd="ls -m interests/"]')).toHaveCount(1);
    await expect(body.locator('[data-cmd="wc -l interests/"]')).toHaveCount(0);
    await expect(
      body.locator('[data-output="conversation, edm, musical theatre, pc gaming, programming"]'),
    ).toHaveCount(1);

    // Skills line is now `printenv STACK` (reframed as an env var), not a second
    // `ls skills/` — differentiated from `ls -m interests/`; output is single-spaced.
    await expect(body.locator('[data-cmd="printenv STACK"]')).toHaveCount(1);
    await expect(body.locator('[data-cmd="ls skills/"]')).toHaveCount(0);
    await expect(
      body.locator('[data-output="aws typescript serverless swift go perl"]'),
    ).toHaveCount(1);

    await expect(widget).toHaveScreenshot('widget-bio-terminal.png', { stylePath });
  });

  test('system status', async () => {
    const widget = page.locator(WIDGET_SELECTORS.systemStatus);
    await expect(widget).toHaveScreenshot('widget-system-status.png', { stylePath });
  });

  test('heart rate', async () => {
    const widget = page.locator(WIDGET_SELECTORS.heartRate);
    await expect(widget).toHaveScreenshot('widget-heart-rate.png', { stylePath });
  });

  test('workouts', async () => {
    const widget = page.locator(WIDGET_SELECTORS.workouts);
    await expect(widget).toHaveScreenshot('widget-workouts.png', { stylePath });
  });

  test('hydration', async () => {
    const widget = page.locator(WIDGET_SELECTORS.hydration);
    await expect(widget).toHaveScreenshot('widget-hydration.png', { stylePath });
  });

  test('night summary', async () => {
    const widget = page.locator(WIDGET_SELECTORS.nightSummary);
    await expect(widget).toHaveScreenshot('widget-night-summary.png', { stylePath });
  });

  test('dev activity log', async () => {
    await stabilizeForLocatorScreenshot(page);
    const widget = page.locator(WIDGET_SELECTORS.devActivityLog);
    await expect(widget).toHaveScreenshot('widget-dev-activity-log.png', { stylePath });
  });

  test('reading feed', async () => {
    await stabilizeForLocatorScreenshot(page);
    const widget = page.locator(WIDGET_SELECTORS.readingFeed);
    await expect(widget).toHaveScreenshot('widget-reading-feed.png', { stylePath });
  });

  test('bookshelf', async () => {
    const widget = page.locator(WIDGET_SELECTORS.bookshelf);
    await expect(widget).toHaveScreenshot('widget-bookshelf.png', { stylePath });
  });

  test('starred repos', async () => {
    await stabilizeForLocatorScreenshot(page);
    const widget = page.locator(WIDGET_SELECTORS.starredRepos);
    await expect(widget).toHaveScreenshot('widget-starred-repos.png', { stylePath });
  });

  test('theatre reviews', async () => {
    const widget = page.locator(WIDGET_SELECTORS.theatreReviews);
    await expect(widget).toHaveScreenshot('widget-theatre-reviews.png', { stylePath });
  });

  test('top bar', async () => {
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

test.describe('Widget variations - Heart Rate Paused', () => {
  test('paused hr gap', async ({ page }) => {
    await setupPage(page, 'hr-paused-hr-gap');
    const widget = page.locator('#cardHR');
    // Behavioral guard: paused block must be visible; data values must not be.
    // If the class-toggle is a no-op (e.g. paused node missing from DOM), the
    // screenshot would show full-brightness BPM data — this assertion catches that.
    await expect(widget.locator('#hrPaused')).toBeVisible();
    await expect(widget.locator('.hr-data')).toBeHidden();
    await expect(widget).toHaveScreenshot('hr-paused-hr-gap.png', { stylePath });
  });

  test('paused charging', async ({ page }) => {
    await setupPage(page, 'hr-paused-charging');
    const widget = page.locator('#cardHR');
    await expect(widget.locator('#hrPaused')).toBeVisible();
    await expect(widget.locator('.hr-data')).toBeHidden();
    await expect(widget).toHaveScreenshot('hr-paused-charging.png', { stylePath });
  });
});

test.describe('Widget variations - Movement Rings Paused', () => {
  test('paused hr gap', async ({ page }) => {
    await setupPage(page, 'hr-paused-hr-gap');
    const widget = page.locator(WIDGET_SELECTORS.movementRings);
    // Behavioral guard: paused block visible; data container (rings + chips) hidden.
    await expect(widget.locator('#mvPaused')).toBeVisible();
    await expect(widget.locator('.mv-data')).toBeHidden();
    await expect(widget).toHaveScreenshot('mv-paused-hr-gap.png', { stylePath });
  });

  test('paused charging', async ({ page }) => {
    await setupPage(page, 'hr-paused-charging');
    const widget = page.locator(WIDGET_SELECTORS.movementRings);
    await expect(widget.locator('#mvPaused')).toBeVisible();
    await expect(widget.locator('.mv-data')).toBeHidden();
    await expect(widget).toHaveScreenshot('mv-paused-charging.png', { stylePath });
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

  // Optional dietaryWater/dietaryCaffeine quantities entirely absent (not zero).
  // Preserves the missing-optional health render path that the `empty` dashboard
  // scenario previously covered before it moved to the real `empty` fixtures.
  test('missing optional', async ({ page }) => {
    await setupPage(page, 'health-missing-optional');
    const widget = page.locator('#cardHydration');
    await expect(widget).toHaveScreenshot('hydration-missing-optional.png', { stylePath });
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
    await stabilizeForLocatorScreenshot(page);
    const widget = page.locator('#cardDevLog');
    await expect(widget).toHaveScreenshot('github-commits-only.png', { stylePath });
  });

  test('prs only', async ({ page }) => {
    await setupPage(page, 'github-prs-only');
    await stabilizeForLocatorScreenshot(page);
    const widget = page.locator('#cardDevLog');
    await expect(widget).toHaveScreenshot('github-prs-only.png', { stylePath });
  });
});

test.describe('Widget variations - Workouts', () => {
  test('multi workout', async ({ page }) => {
    await setupPage(page, 'workouts-multi');
    await stabilizeForLocatorScreenshot(page);
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

test.describe('Widget variations - Reading Feed', () => {
  // Bug-6 regression: articles with empty articleTitle ("") + long sourceTitle
  // must render without crashing or producing a blank/broken widget row.
  test('empty title', async ({ page }) => {
    await setupPage(page, 'reading-empty-title');
    await stabilizeForLocatorScreenshot(page);
    const widget = page.locator(WIDGET_SELECTORS.readingFeed);
    await expect(widget).toHaveScreenshot('reading-empty-title.png', { stylePath });
  });
});

// ---------------------------------------------------------------------------
// 4c: Overlay Tests
// ---------------------------------------------------------------------------

test.describe('Overlays', () => {
  test('focus overlay', async ({ page }) => {
    await setupPage(page, 'focus-work', { waitForScrollHeight: true });
    await page.locator('#focusOverlay').waitFor({ state: 'visible', timeout: 10000 });
    await captureFullPage(page, 'focus-overlay.png', { stylePath });
  });

  test('dnd overlay', async ({ page }) => {
    await setupPage(page, 'focus-dnd', { waitForScrollHeight: true });
    await page.locator('#dndOverlay').waitFor({ state: 'visible', timeout: 10000 });
    await captureFullPage(page, 'dnd-overlay.png', { stylePath });
  });
});

// ---------------------------------------------------------------------------
// 4d: System-status provenance popover — OPEN state (with caret)
//
// The closed-state baseline (widget-system-status.png) can't catch a
// broken/absent/wrong-pointing caret, and the popover is a top-layer element
// that isn't in the widget's element screenshot. This single open-state
// snapshot is the only automated guard for caret correctness under auto-merge.
//
// Restricted to ONE Chromium viewport (desktop-1400): keeping it single-engine
// / single-viewport means it never exercises the cross-engine @supports
// fallback and produces exactly one deterministic baseline. The clip is
// expanded around the popover box to include the caret (in the margin, revealed
// by clip-path) and the drop-shadow.
// ---------------------------------------------------------------------------
test.describe('System status — open popover with caret', () => {
  test('health popover open', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-1400',
      'Chromium single-viewport guard — one deterministic baseline, no cross-engine fallback',
    );

    await setupPage(page, 'populated');

    const button = page.locator('#systemStatus .sys-line[data-source="health"] .sys-info');
    await button.click();

    const popover = page.locator('#tip-health');
    await expect(popover).toBeVisible();

    // Pin the popover to its production width. The Health popover's content
    // exceeds the 280px cap, so in production `width: max-content` clamps to
    // exactly 280px — this pin renders identically but removes the sub-pixel
    // max-content flake that otherwise varies the box (and thus a float-derived
    // clip) a few px run-to-run. Determinism stabilization only (cf. screenshot.css).
    await popover.evaluate((el) => {
      (el as HTMLElement).style.width = '280px';
    });
    // Apply the stabilization stylesheet (screenshot.css) BEFORE measuring the
    // box -- this is the crux of the popover's determinism. toHaveScreenshot
    // injects that same stylesheet at capture time; it reflows the panel and
    // freezes the sys-line reveal animation, settling the popover at its final
    // anchored position. Measuring box.x on the un-styled page (as before) read a
    // mid-reveal position ~28px off that also jittered a pixel or two run-to-run,
    // so the fixed clip -- derived from that stale box -- disagreed with the
    // capture and flaked (~10% diff, intermittent). Measuring AFTER the
    // stylesheet is applied makes box.x deterministic and makes the clip agree
    // with the capture; verified byte-identical across 10 consecutive workers=1
    // renders (an element screenshot is also stable but would clip off the caret,
    // and an earlier `translate` grid-snap broke local<->CI byte parity).
    await page.addStyleTag({ path: stylePath });
    await stabilizeForLocatorScreenshot(page);
    // The native popover's anchor-positioned placement can settle a frame or two
    // after open; on loaded CI runners the fixed clip below was measured (and the
    // page captured) mid-settle, so the clip disagreed with the settled popover
    // and flaked ~5-7% (the diff shrank on retry as it settled). Wait for the box
    // to stop moving before deriving the clip. No baseline change: the settled
    // render is what the committed baseline already holds.
    await waitForStableBox(popover);

    const box = await popover.boundingBox();
    if (!box) throw new Error('health popover has no bounding box');

    // Fixed integer clip anchored to the (now-stable) box origin. Fixed
    // width/height avoid any dependence on the fractional box size; the pad
    // covers the caret (~8px above the top edge, in the margin) and the layered
    // drop-shadow (~20px). No transform, so parity with the other captures holds.
    const padX = 16;
    const padTop = 16;
    const clip = {
      x: Math.round(box.x) - padX,
      y: Math.round(box.y) - padTop,
      width: 280 + padX * 2,
      height: 120,
    };

    await expect(page).toHaveScreenshot('system-status-popover-open.png', { clip, stylePath });
  });
});
