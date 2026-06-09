import { test, expect } from '@playwright/test';
import { setupPage, stylePath } from './helpers';

test.describe('Dashboard - populated', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'populated', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }, testInfo) => {
    // Upstream Playwright/Chromium PNG encoder produces buffers that the
    // sharp/libvips decoder rejects for tablet-1100 fullPage screenshots.
    // Reproducible across 6 regen runs with every research-supported fix
    // applied (workers=1, --ipc=host, --shm-size=2g, --disable-dev-shm-usage,
    // gitattributes binary). TODO: revisit when Playwright >= 1.61 or migrate
    // to clip-region capture.
    test.fixme(testInfo.project.name === 'tablet-1100', 'Upstream PNG encoder bug — see PR #44');
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

  test('full page', async ({ page }, testInfo) => {
    test.fixme(testInfo.project.name === 'tablet-1100', 'Upstream PNG encoder bug — see PR #44');
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

  test('full page', async ({ page }, testInfo) => {
    test.fixme(testInfo.project.name === 'tablet-1100', 'Upstream PNG encoder bug — see PR #44');
    await expect(page).toHaveScreenshot('dashboard-complex.png', {
      fullPage: true,
      stylePath,
    });
  });
});
