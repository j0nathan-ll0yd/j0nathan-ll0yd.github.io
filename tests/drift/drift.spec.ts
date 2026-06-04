import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE_URL = 'https://jonathanlloyd.me';

test('production dashboard matches drift baseline', async ({ page }, testInfo) => {
  const baselinePath = join(
    testInfo.project.testDir,
    '__screenshots__',
    testInfo.project.name,
    'drift.spec.ts',
    'drift-full.png',
  );
  test.skip(
    process.env.CI === 'true' && !existsSync(baselinePath),
    `Drift baseline not yet committed at ${baselinePath} — skipping first-run on CI to avoid noisy issue filing. Generate locally with --update-snapshots and commit.`,
  );

  await page.goto(`${SITE_URL}/?bust=${Date.now()}`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('drift-full.png', {
    mask: [
      // Dynamic content that changes on every load — mask to avoid false positives
      page.locator('#liveClock'),
      page.locator('#pollStatus'),
      page.locator('#hrEcgCanvas'),
      // Health widgets contain live-updated values
      page.locator('#cardHR'),
      page.locator('#cardSleep'),
      page.locator('#cardHydration'),
    ],
    maxDiffPixelRatio: 0.05,
    fullPage: true,
  });
});
