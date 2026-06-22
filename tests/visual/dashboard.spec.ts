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

// The DS standard-triad `full` variation: every domain at its maximally-populated
// shape. Like every other dashboard scenario, the SSR shell stays `baseline`; the
// `full` data is injected purely via route interception + client re-hydration
// (helpers.ts `interceptRoutes`), NOT via the SSR `FIXTURE_VARIATION` path. Expected
// to look similar to `dashboard-complex` — see the `full` scenario note in fixtures.ts.
test.describe('Dashboard - full', () => {
  test.beforeEach(async ({ page }) => {
    await setupPage(page, 'full', { waitForScrollHeight: true });
  });

  test('full page', async ({ page }) => {
    await captureFullPage(page, 'dashboard-full.png', { stylePath });
  });
});
