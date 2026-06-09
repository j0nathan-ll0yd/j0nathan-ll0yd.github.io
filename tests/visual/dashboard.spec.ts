import { test } from '@playwright/test';
import { setupPage, stylePath, captureFullPage } from './helpers';

test.describe('Dashboard - populated', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'populated', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }, testInfo) => {
    // Upstream Chromium/pngjs PNG encoder bug — viewport-grow+clip{} does NOT
    // bypass it on tablet-1100. See PR #48 CI run 27215737377. Tracking upstream.
    test.fixme(testInfo.project.name === 'tablet-1100', 'Upstream PNG encoder bug — viewport-grow+clip insufficient');
    await captureFullPage(page, 'dashboard-populated.png', { stylePath });
  });
});

test.describe('Dashboard - empty', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'empty', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }, testInfo) => {
    test.fixme(testInfo.project.name === 'tablet-1100', 'Upstream PNG encoder bug — viewport-grow+clip insufficient');
    await captureFullPage(page, 'dashboard-empty.png', { stylePath });
  });
});

test.describe('Dashboard - complex', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'complex', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }, testInfo) => {
    test.fixme(testInfo.project.name === 'tablet-1100', 'Upstream PNG encoder bug — viewport-grow+clip insufficient');
    await captureFullPage(page, 'dashboard-complex.png', { stylePath });
  });
});
