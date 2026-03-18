import path from 'path';
import { test, expect } from '@playwright/test';

const CLOUDFRONT_BASE = 'https://d2nfgi9u0n3jr6.cloudfront.net';
const WEBSOCKET_URL = 'wss://0f4imrwcq2.execute-api.us-west-2.amazonaws.com';

const FIXTURE_MAP: Record<string, string> = {
  '/health.json': 'health.json',
  '/sleep.json': 'sleep.json',
  '/workouts.json': 'workouts.json',
  '/books.json': 'books.json',
  '/github-starred-repos.json': 'github-starred-repos.json',
  '/github-events.json': 'github-events.json',
  '/articles.json': 'articles.json',
  '/location.json': 'location.json',
  '/focus.json': 'focus.json',
  '/theatre-reviews.json': 'theatre-reviews.json',
};

const stylePath = path.join(import.meta.dirname, 'screenshot.css');

test.beforeEach(async ({ page }) => {
  // Intercept CloudFront API calls with stable fixture data
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const url = new URL(route.request().url());
    const fixture = FIXTURE_MAP[url.pathname];
    if (fixture) {
      await route.fulfill({
        path: path.join(import.meta.dirname, '..', 'fixtures', fixture),
        contentType: 'application/json',
      });
    } else {
      await route.abort();
    }
  });

  // Block WebSocket connections
  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort());

  // Navigate and wait for stable render
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
});

test.describe('Full page screenshots', () => {
  test('dashboard full page', async ({ page }) => {
    await expect(page).toHaveScreenshot('dashboard-full.png', {
      fullPage: true,
      stylePath,
    });
  });

  test('dashboard viewport', async ({ page }) => {
    await expect(page).toHaveScreenshot('dashboard-viewport.png', {
      stylePath,
    });
  });
});

test.describe('Widget screenshots', () => {
  test('identity card', async ({ page }) => {
    const card = page.locator('.identity-card');
    await expect(card).toHaveScreenshot('identity-card.png', { stylePath });
  });

  test('top bar', async ({ page }) => {
    const topBar = page.locator('.top-bar');
    await expect(topBar).toHaveScreenshot('top-bar.png', { stylePath });
  });
});
