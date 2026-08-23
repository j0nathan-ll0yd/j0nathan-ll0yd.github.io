/**
 * ECG animation uses requestAnimationFrame and random jitter, so screenshots need deterministic
 * seed, time, and step controls. The seam installs only in test mode under a data-test ancestor.
 * Production-mode previews skip these cases; design-system Vitest still verifies determinism.
 * Enable screenshots when visual previews build with `astro build --mode test`.
 */
import {expect, type Page, test} from './pw-fixtures'
import {setupPage, stylePath, WIDGET_SELECTORS} from './helpers'

interface HeartRateSeam {
  ready: boolean
  seed: (n: number) => void
  freezeAt: (ms: number | null) => void
  step: (frames?: number) => void
  state: () => {bpm: number; hrv: number; currentX: number; lastBeatAt: number}
}

type SeamWindow = typeof window & {__hrEcg?: HeartRateSeam; __ecgUpdate?: (bpm: number, hrv: number, stroke: string) => void}

/** Opt the heart-rate card into the seam, then wait for it to install + be ready. */
async function armSeam(page: Page): Promise<void> {
  await page.evaluate((cardSel) => {
    document.querySelector(cardSel)?.setAttribute('data-test', '1')
  }, WIDGET_SELECTORS.heartRate)
  // The seam installs at island-bootstrap time. If MODE !== 'test' it never
  // appears; the describe-level skip below short-circuits before we get here.
  await page.waitForFunction(() => Boolean((window as SeamWindow).__hrEcg))
}

async function seamAvailable(page: Page): Promise<boolean> {
  await setupPage(page, 'populated')
  return page.evaluate(() => Boolean((window as SeamWindow).__hrEcg))
}

test.describe('ECG canvas - deterministic seam', () => {
  // Runtime skip: the seam is absent in a production preview build (see header).
  test.beforeEach(async ({page}) => {
    const available = await seamAvailable(page)
    test.skip(!available, 'window.__hrEcg unavailable: visual preview is a production build (MODE !== "test")')
  })

  test('ECG @ 60bpm baseline', async ({page}) => {
    await armSeam(page)
    await page.evaluate(() => {
      const seam = (window as SeamWindow).__hrEcg!
      seam.seed(42)
      seam.freezeAt(0)
      seam.step(60)
    })
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-60bpm.png', {stylePath})
  })

  test('ECG @ 90bpm elevated', async ({page}) => {
    await armSeam(page)
    await page.evaluate(() => {
      const w = window as SeamWindow
      w.__ecgUpdate?.(90, 42, '#f59e0b')
      const seam = w.__hrEcg!
      seam.seed(42)
      seam.freezeAt(0)
      seam.step(60)
    })
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-90bpm.png', {stylePath})
  })

  test('ECG @ 50bpm bradycardia', async ({page}) => {
    await armSeam(page)
    await page.evaluate(() => {
      const w = window as SeamWindow
      w.__ecgUpdate?.(50, 60, '#3a86ff')
      const seam = w.__hrEcg!
      seam.seed(42)
      seam.freezeAt(0)
      seam.step(60)
    })
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-50bpm.png', {stylePath})
  })

  test('ECG reduced-motion static waveform', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'})
    await armSeam(page)
    // Reduced motion draws a single static waveform at bootstrap; no stepping.
    await expect(page.locator(WIDGET_SELECTORS.heartRateCanvas)).toHaveScreenshot('ecg-reduced-motion.png', {stylePath})
  })
})
