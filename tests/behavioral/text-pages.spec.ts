/**
 * Text-page behavioral tests (atlas decision 0158): /about, /contact, /developers, and
 * /privacy. DOM and layout assertions only, no screenshots. Runs under the desktop
 * (1400x900) and mobile (390x844) behavioral projects.
 *
 * The regression under guard: Dashboard.astro locks viewport scroll at 1400px wide
 * (`html, body { overflow: hidden }` above 1100px) so the bento grid fits 100dvh. Every
 * text page shares that layout, and /developers is about 2,100px tall, so without the
 * InfoPage override nothing below the first viewport could be reached. The footer's last
 * link is the deepest element on each page; a mouse-wheel scroll must bring it into view.
 */
import {expect, test} from '@playwright/test'

const PAGES = ['/about', '/contact', '/developers', '/privacy']

for (const path of PAGES) {
  test.describe(path, () => {
    test('scrolls to its footer the way a user does: the last element is reachable', async ({page}) => {
      await page.goto(path)
      await expect(page.locator('h1')).toBeVisible()
      // html overflow propagates to the viewport, so both elements must leave scrolling on.
      expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).not.toBe('hidden')
      expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')

      // A wheel event, not scrollIntoView: programmatic scrolling moves an overflow:hidden
      // container too, so only a user-path scroll proves a reader can get there.
      const viewport = page.viewportSize()!
      await page.mouse.move(viewport.width / 2, viewport.height / 2)
      await page.mouse.wheel(0, 20_000)
      await expect(page.locator('footer nav a').last()).toBeInViewport()
    })

    test('marks itself current in the shared footer navigation', async ({page}) => {
      await page.goto(path)
      await expect(page.locator('footer nav a[aria-current="page"]')).toHaveAttribute('href', path)
    })
  })
}
