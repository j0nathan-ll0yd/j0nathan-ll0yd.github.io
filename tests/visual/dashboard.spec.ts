import { test, expect } from '@playwright/test';
import { setupPage, stylePath } from './helpers';

test.describe('Dashboard - populated', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'populated', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }) => {
    await expect(page).toHaveScreenshot('dashboard-populated.png', {
      fullPage: true,
      stylePath,
    });
  });
});

test.describe('Dashboard - empty', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'empty', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }) => {
    await expect(page).toHaveScreenshot('dashboard-empty.png', {
      fullPage: true,
      stylePath,
    });
  });
});

test.describe('Dashboard - complex', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'complex', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }) => {
    await expect(page).toHaveScreenshot('dashboard-complex.png', {
      fullPage: true,
      stylePath,
    });
  });
});
