/**
 * Shared test helpers for visual regression tests.
 *
 * Provides route interception, navigation/wait logic, and widget selectors.
 */
import path from 'path';
import { expect, type Locator, type Page } from '@playwright/test';
import { CLOUDFRONT_BASE, WEBSOCKET_URL } from '@lifegames/portal-contract/constants';
import { getScenarioFixtures, scenarioHasWorkouts, type ScenarioName } from './fixtures';

export const stylePath = path.join(import.meta.dirname, 'screenshot.css');

/** Widget selectors for element-level screenshots. */
export const WIDGET_SELECTORS = {
  identityCard: '#identityCard',
  bioTerminal: '#cardBio',
  systemStatus: '#cardSystem',
  heartRate: '#cardHR',
  // Canvas-only selector for seam-driven deterministic ECG snapshots.
  heartRateCanvas: '#hrEcgCanvas',
  movementRings: '#cardMovement',
  workouts: '#cardWorkouts',
  hydration: '#cardHydration',
  nightSummary: '#cardSleep',
  devActivityLog: '#cardDevLog',
  readingFeed: '#cardReading',
  starredRepos: '#cardStarredRepos',
  bookshelf: '#cardBooks',
  theatreReviews: '#cardTheatreReviews',
  topBar: '.top-bar',
} as const;

/** 1×1 transparent PNG (68 bytes) used as a placeholder for external images */
const TRANSPARENT_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB'
    + 'Nl7BcQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Set up route interception for all CloudFront endpoints + WebSocket block.
 * Serves fixture JSON based on the given scenario.
 * Also intercepts external image requests (Amazon, etc.) with a transparent pixel
 * to prevent broken images in screenshots.
 */
export async function interceptRoutes(page: Page, scenario: ScenarioName): Promise<void> {
  const fixtures = getScenarioFixtures(scenario);

  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const fixturePath = fixtures[url.pathname];
    if (fixturePath) {
      await route.fulfill({
        path: fixturePath,
        contentType: 'application/json',
      });
    } else {
      await route.abort();
    }
  });

  // Block WebSocket connections
  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort());

  // Catch-all: intercept any remaining external requests (Amazon images,
  // coasttocoastreviews.com posters, etc.). Image requests get a transparent
  // pixel so <img> tags don't show broken alt-text; everything else is aborted.
  // Registered last but checked first (Playwright uses LIFO), so we use
  // route.fallback() for URLs already handled by earlier route handlers.
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    // Let local requests and already-handled domains fall through
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
    // Serve transparent pixel for image requests
    const resourceType = route.request().resourceType();
    if (resourceType === 'image') {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: TRANSPARENT_PIXEL,
      });
    } else {
      await route.abort();
    }
  });
}

export interface NavigateOptions {
  /** Wait for #cardWorkouts to become visible. Set true when the scenario includes non-empty workouts data. */
  waitForWorkouts?: boolean;
  /** Wait for documentElement.scrollHeight to stabilize. Only needed for fullPage screenshots. */
  waitForScrollHeight?: boolean;
}

/**
 * Navigate to the dashboard and wait for a stable render.
 *
 * Waits for: fonts ready, network idle, skeleton removal, scroll-height
 * stabilization (for responsive viewports), and bio terminal animation.
 * screenshot.css forces opacity: 1 on all cards, bypassing the staggered
 * reveal animation. Data population is confirmed by skeleton removal below.
 */
export async function navigateAndWait(page: Page, options: NavigateOptions = {}): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  // Wait for all skeleton loading states to be removed -- this is the real
  // readiness signal (data has populated the DOM). Replaces `networkidle`,
  // which is unreliable on this page due to PollEngine and SW background fetches.
  await page.waitForFunction(
    () => document.querySelectorAll('.is-loading').length === 0,
    { timeout: 10000 },
  );

  // Wait for every <img> in the document to finish loading (complete === true
  // OR naturalWidth === 0 for blocked images). Without this, an image that
  // resolves after fonts.ready can shift layout by a few pixels right before
  // capture, producing flaky page-height drift even within the same env.
  await page.waitForFunction(
    () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      // Inlined copy of allImagesComplete() from ./predicates.ts (cannot import inside waitForFunction).
      // If you change one, update the other.
      return imgs.every((img) => img.complete);
    },
    { timeout: 10000 },
  ).catch(() => {
    // Non-fatal: some intercepted/aborted images may never report complete.
    // We continue rather than fail the test.
  });

  // If the scenario has workouts data, wait for the card to become visible
  // (#cardWorkouts starts display: none and is shown by updateWorkouts())
  if (options.waitForWorkouts) {
    await page.locator('#cardWorkouts').waitFor({ state: 'visible', timeout: 10000 });
  }

  // Bio terminal + scroll-height stabilization are only needed for fullPage
  // screenshots and for the populated widgets shared-page navigation that
  // includes the terminal in its element capture. Widget-variation tests skip
  // both, since their locator screenshots don't include the terminal and
  // don't depend on total document height.
  if (options.waitForScrollHeight) {
    // Wait for the bio terminal typewriter animation to finish. On mobile
    // (<768px) lines are set visible immediately; on desktop the
    // IntersectionObserver triggers a sequential typing animation. Scroll the
    // card into view first to ensure the observer fires at all viewports.
    const bioCard = page.locator('#cardBio');
    if (await bioCard.count() > 0) {
      await bioCard.scrollIntoViewIfNeeded();
    }
    await page.waitForFunction(
      () => {
        const lines = document.querySelectorAll('#terminalBody .terminal-line');
        if (lines.length === 0) return true;
        return lines[lines.length - 1].classList.contains('visible');
      },
      { timeout: 15000 },
    ).catch(async () => {
      // Fallback: force lines visible if the IntersectionObserver never fires.
      await page.evaluate(() => {
        document.querySelectorAll('#terminalBody .terminal-line').forEach((line) => {
          line.classList.add('visible');
          const el = line as HTMLElement;
          const cmd = el.dataset.cmd;
          const output = el.dataset.output;
          const cmdSpan = el.querySelector('.terminal-command') as HTMLElement | null;
          const outSpan = el.querySelector('.terminal-output') as HTMLElement | null;
          if (cmd && cmdSpan && !cmdSpan.textContent) cmdSpan.textContent = cmd;
          if (output && outSpan && !outSpan.textContent) outSpan.textContent = output;
        });
      });
    });

    // Wait for scroll height to stabilize so fullPage screenshots capture the
    // entire document. At responsive breakpoints the layout switches from
    // height:100dvh to height:auto and the DOM needs time to reflow.
    //
    // Require THREE consecutive equal reads at 150ms intervals (~450ms min
    // settle window) to absorb async layout shifts (image decode, font swap,
    // late-arriving widget content) that a single 200ms check missed.
    await page.waitForFunction(
      () => {
        return new Promise<boolean>((resolve) => {
          const reads: number[] = [document.documentElement.scrollHeight];
          let i = 0;
          const tick = () => {
            i++;
            reads.push(document.documentElement.scrollHeight);
            if (i < 3) {
              setTimeout(tick, 150);
              return;
            }
            // Inlined copy of scrollHeightStable() from ./predicates.ts (cannot import inside waitForFunction).
            // If you change one, update the other.
            resolve(reads.every((v) => v === reads[0]));
          };
          setTimeout(tick, 150);
        });
      },
      { timeout: 10000 },
    );
  }
}

/**
 * Convenience: intercept routes and navigate in one call.
 * Automatically determines whether to wait for workouts based on the scenario.
 */
export async function setupPage(page: Page, scenario: ScenarioName, options?: NavigateOptions): Promise<void> {
  await interceptRoutes(page, scenario);
  const hasWorkouts = options?.waitForWorkouts ?? scenarioHasWorkouts(scenario);
  await navigateAndWait(page, {
    waitForWorkouts: hasWorkouts,
    waitForScrollHeight: options?.waitForScrollHeight ?? false,
  });
}

/**
 * Capture a fullPage-equivalent screenshot via viewport-grow + clip{}.
 *
 * Bypasses Chromium's stitched-capture pipeline (Chromium 331796402,
 * Playwright #30149, #20859, #35674) which produces truncated/corrupt PNGs
 * on tall pages. The pngjs decoder Playwright bundles strict-rejects these
 * truncated buffers with "unrecognised content at end of stream".
 *
 * Approach (per Playwright #35674):
 *   1. Wait for fonts.ready + 2x rAF to ensure layout has settled.
 *   2. Measure document.documentElement.scrollHeight.
 *   3. Grow the viewport to {width, height: measured} so the full document
 *      fits in one frame.
 *   4. Capture via clip{ x:0, y:0, width, height } (no fullPage stitch).
 *
 * Caller is responsible for restoring viewport if the test is in serial
 * mode (Playwright auto-isolates fresh pages otherwise).
 *
 * Depends on screenshot.css (lines 73-76) which sets html/body to
 * `height: auto !important; overflow: visible !important` -- without that
 * rule, scrollHeight is capped by `height: 100dvh` and clip captures truncate.
 */
export async function captureFullPage(
  page: Page,
  screenshotName: string,
  opts?: { stylePath?: string; },
): Promise<void> {
  // Stability: fonts + 2x rAF to absorb late layout shifts
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });

  const viewport = page.viewportSize();
  if (!viewport) {
    throw new Error('captureFullPage: no viewport configured on page');
  }

  // Measure the true content height. On desktop (>=1100px) the document body
  // does NOT scroll — the layout uses independent fixed-height scroll columns
  // (.left-panel and .right-panel are each `height: 100dvh; overflow-y: auto`,
  // layout.css:17-30,96-101) with a `position: fixed` top-bar. So
  // documentElement.scrollHeight is capped at one viewport (100dvh) and a clip
  // of it truncates everything below the fold. The real content height is the
  // tallest column. Growing the viewport to it expands each column's `100dvh`
  // so the full document renders in one frame.
  //
  // We also reset each column's scrollTop to 0 first: navigateAndWait() calls
  // #cardBio.scrollIntoViewIfNeeded() to trigger the bio typewriter observer,
  // which scrolls the left column down and would otherwise clip the identity
  // card / avatar at the top of the capture.
  //
  // documentElement.scrollHeight is kept in the max() so responsive breakpoints
  // (<768px), where the columns become in-flow and the body scrolls, still
  // measure the full page correctly.
  const measuredHeight = await page.evaluate(() => {
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>('.left-panel, .right-panel'),
    );
    panels.forEach((panel) => {
      panel.scrollTop = 0;
    });
    const tallestPanel = panels.reduce((max, panel) => Math.max(max, panel.scrollHeight), 0);
    return Math.max(document.documentElement.scrollHeight, tallestPanel);
  });
  if (measuredHeight <= 0) {
    throw new Error(`captureFullPage: scrollHeight is ${measuredHeight} — page may not have loaded`);
  }

  await page.setViewportSize({ width: viewport.width, height: measuredHeight });

  // Let the grown viewport reflow (100dvh recalculates against the new height)
  // before capturing.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

  await expect(page).toHaveScreenshot(screenshotName, {
    clip: { x: 0, y: 0, width: viewport.width, height: measuredHeight },
    stylePath: opts?.stylePath,
  });
}

/**
 * Settle the page before capturing a locator-level screenshot.
 *
 * Used for widget-level screenshots (`page.locator(...).toHaveScreenshot()`).
 * Without this wait, the screenshot can be captured mid-composite, producing
 * truncated/corrupt PNG buffers that the pngjs decoder strict-rejects.
 *
 * Cheaper than full captureFullPage settling — only needs fonts.ready + 2x rAF.
 */
export async function stabilizeForLocatorScreenshot(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/**
 * Wait until a locator's bounding box stops moving -- unchanged within
 * `epsilonPx` across `framesRequired` consecutive animation frames, or until
 * `timeoutMs` elapses.
 *
 * A native popover (`popover="auto"`) positioned via CSS anchor positioning
 * settles a frame or two after it opens. On loaded CI runners a screenshot taken
 * mid-settle produced an intermittent ~5-7% diff: the box shifted a pixel
 * between the in-test clip measurement and the capture, so the fixed clip
 * disagreed with where the popover finally landed (the diff shrank on retry as
 * it settled further). Polling to a stable box before measuring the clip removes
 * that race WITHOUT relaxing the pixel match -- the settled render is identical
 * to the committed baseline, so no baseline changes.
 */
export async function waitForStableBox(
  locator: Locator,
  {
    epsilonPx = 0.5,
    framesRequired = 5,
    timeoutMs = 2000,
  }: { epsilonPx?: number; framesRequired?: number; timeoutMs?: number; } = {},
): Promise<void> {
  const nextFrame = () =>
    locator
      .page()
      .evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  let prev = await locator.boundingBox();
  let stableFrames = 0;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && stableFrames < framesRequired) {
    await nextFrame();
    const box = await locator.boundingBox();
    const settled = box !== null
      && prev !== null
      && Math.abs(box.x - prev.x) <= epsilonPx
      && Math.abs(box.y - prev.y) <= epsilonPx
      && Math.abs(box.width - prev.width) <= epsilonPx
      && Math.abs(box.height - prev.height) <= epsilonPx;
    stableFrames = settled ? stableFrames + 1 : 0;
    prev = box;
  }
}
