import { test } from './pw-fixtures';
import { setupPage, stylePath, captureFullPage } from './helpers';

test.describe('Dashboard - populated', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'populated', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }) => {
    await captureFullPage(page, 'dashboard-populated.png', { stylePath });
  });
});

test.describe('Dashboard - empty', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'empty', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }) => {
    await captureFullPage(page, 'dashboard-empty.png', { stylePath });
  });
});

test.describe('Dashboard - complex', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'complex', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }) => {
    await captureFullPage(page, 'dashboard-complex.png', { stylePath });
  });
});
