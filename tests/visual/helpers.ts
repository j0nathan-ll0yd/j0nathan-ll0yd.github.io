/**
 * Shared test helpers for visual regression tests.
 *
 * Provides route interception, navigation/wait logic, and widget selectors.
 */
import path from 'path';
import type { Page } from '@playwright/test';
import { getScenarioFixtures, scenarioHasWorkouts, type ScenarioName } from './fixtures';

const CLOUDFRONT_BASE = 'https://d1pfm520aduift.cloudfront.net';
const WEBSOCKET_URL = 'wss://iu1k9jv4mi.execute-api.us-west-2.amazonaws.com';

export const stylePath = path.join(import.meta.dirname, 'screenshot.css');

/** Widget selectors for element-level screenshots. */
export const WIDGET_SELECTORS = {
  identityCard: '#identityCard',
  bioTerminal: '#cardBio',
  systemStatus: '#cardSystem',
  heartRate: '#cardHR',
  dailyActivity: '#cardSteps',
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
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
  'Nl7BcQAAAABJRU5ErkJggg==',
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
      url.startsWith('http://localhost') ||
      url.startsWith('data:') ||
      url.startsWith(CLOUDFRONT_BASE) ||
      url.startsWith(WEBSOCKET_URL.replace('wss://', 'https://')) ||
      url.startsWith('wss://')
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
  // Bypass the BioTerminal typewriter animation. The component short-circuits
  // when prefers-reduced-motion is set, marking all lines visible immediately
  // with full SSR text. Avoids a 15s observer wait and a textContent race that
  // corrupts the terminal text mid-typing.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  // Wait for all skeleton loading states to be removed -- this is the real
  // readiness signal (data has populated the DOM). Replaces `networkidle`,
  // which is unreliable on this page due to PollEngine and SW background fetches.
  await page.waitForFunction(
    () => document.querySelectorAll('.is-loading').length === 0,
    { timeout: 10000 },
  );

  // If the scenario has workouts data, wait for the card to become visible
  // (#cardWorkouts starts display: none and is shown by updateWorkouts())
  if (options.waitForWorkouts) {
    await page.locator('#cardWorkouts').waitFor({ state: 'visible', timeout: 10000 });
  }

  // BioTerminal honors prefers-reduced-motion: under reduced-motion (set in
  // playwright.config.ts) the typewriter is skipped and all lines are marked
  // visible immediately with full text from SSR. No wait needed here.

  // Wait for scroll height to stabilize so fullPage screenshots capture the
  // entire document. Only relevant for fullPage:true tests -- skip for
  // widget-locator screenshots where reflow doesn't affect the capture.
  if (options.waitForScrollHeight) {
    await page.waitForFunction(
      () => {
        const h = document.documentElement.scrollHeight;
        return new Promise<boolean>((resolve) => {
          setTimeout(() => {
            resolve(document.documentElement.scrollHeight === h);
          }, 200);
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
