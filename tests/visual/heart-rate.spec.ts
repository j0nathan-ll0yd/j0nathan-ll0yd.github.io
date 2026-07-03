/**
 * Deterministic ECG visual regression tests (Plan #06).
 *
 * The ECG canvas (#hrEcgCanvas) animates via requestAnimationFrame + RNG
 * jitter, which defeats Playwright's animations:'disabled'. Previously the
 * canvas was hidden in screenshot.css (the "paper over flake" anti-pattern).
 * That carve-out is now removed; instead the canvas exposes a deterministic
 * test seam, window.__hrEcg, defined in @lifegames/web/runtime/heart-rate-init:
 *
 *   window.__hrEcg = {
 *     ready: boolean,                 // true after the first step()
 *     seed(n: number): void,          // pin the mulberry32 jitter stream
 *     freezeAt(ms: number|null): void,// freeze the clock (null = real time)
 *     step(frames = 1): void,         // advance N frames deterministically
 *     state(): { bpm, hrv, currentX, lastBeatAt },
 *   };
 *
 * Canonical usage: seed(42) -> freezeAt(0) -> step(N) -> screenshot.
 *
 * ACTIVATION REQUIREMENT (intentional production-safety gate):
 * The seam installs ONLY when BOTH gates pass (defense in depth, per the plan's
 * hard constraint that the seam must never ship to production users):
 *   1. import.meta.env.MODE === 'test'  (a vite/astro `--mode test` build), AND
 *   2. the canvas has a `data-test="1"` ancestor.
 * Playwright's webServer currently runs a *production* `astro build` (MODE =
 * 'production'), so gate 1 is false and window.__hrEcg is undefined in the
 * served site. Until the visual webServer builds with `--mode test`, the seam
 * cannot drive these screenshots, so this suite is skipped at runtime.
 *
 * The seam's determinism itself IS verified today, in the design system's
 * Vitest suite (which runs in MODE === 'test'):
 *   design-system-Lifegames/packages/web/tests/runtime/heart-rate-init.test.ts
 *
 * To enable this suite (a separate, deferred change owned by the visual-refresh
 * session): build the visual preview with `astro build --mode test`, then run
 * `npm run test:visual:update:docker` to mint the baselines below.
 */
import { test, expect, type Page } from './pw-fixtures';
import { setupPage, stylePath, WIDGET_SELECTORS } from './helpers';

interface HeartRateSeam {
  ready: boolean;
  seed: (n: number) => void;
  freezeAt: (ms: number | null) => void;
  step: (frames?: number) => void;
  state: () => { bpm: number; hrv: number; currentX: number; lastBeatAt: number; };
}

type SeamWindow = typeof window & {
  __hrEcg?: HeartRateSeam;
  __ecgUpdate?: (bpm: number, hrv: number, stroke: string) => void;
};

/** Opt the heart-rate card into the seam, then wait for it to install + be ready. */
async function armSeam(page: Page): Promise<void> {
  await page.evaluate((cardSel) => {
    document.querySelector(cardSel)?.setAttribute('data-test', '1');
  }, WIDGET_SELECTORS.heartRate);
  // The seam installs at island-bootstrap time. If MODE !== 'test' it never
  // appears; the describe-level skip below short-circuits before we get here.
  await page.waitForFunction(() => Boolean((window as SeamWindow).__hrEcg));
}

async function seamAvailable(page: Page): Promise<boolean> {
  await setupPage(page, 'populated');
  return page.evaluate(() => Boolean((window as SeamWindow).__hrEcg));
}

test.describe('ECG canvas - deterministic seam', () => {
  // Runtime skip: the seam is absent in a production preview build (see header).
  test.beforeEach(async ({ page }) => {
    const available = await seamAvailable(page);
    test.skip(!available, 'window.__hrEcg unavailable: visual preview is a production build (MODE !== "test")');
  });

  test('ECG @ 60bpm baseline', async ({ page }) => {
    await armSeam(page);
    await page.evaluate(() => {
      const seam = (window as SeamWindow).__hrEcg!;
      seam.seed(42);
      seam.freezeAt(0);
      seam.step(60);
    });
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-60bpm.png', { stylePath });
  });

  test('ECG @ 90bpm elevated', async ({ page }) => {
    await armSeam(page);
    await page.evaluate(() => {
      const w = window as SeamWindow;
      w.__ecgUpdate?.(90, 42, '#f59e0b');
      const seam = w.__hrEcg!;
      seam.seed(42);
      seam.freezeAt(0);
      seam.step(60);
    });
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-90bpm.png', { stylePath });
  });

  test('ECG @ 50bpm bradycardia', async ({ page }) => {
    await armSeam(page);
    await page.evaluate(() => {
      const w = window as SeamWindow;
      w.__ecgUpdate?.(50, 60, '#3a86ff');
      const seam = w.__hrEcg!;
      seam.seed(42);
      seam.freezeAt(0);
      seam.step(60);
    });
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-50bpm.png', { stylePath });
  });

  test('ECG reduced-motion static waveform', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await armSeam(page);
    // Reduced motion draws a single static waveform at bootstrap; no stepping.
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-reduced-motion.png', {
      stylePath,
    });
  });
});
