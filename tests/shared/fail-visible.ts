// The fail-visible property of the design system's entry-animated rows and tiles (@j0nathan-ll0yd/web
// 4.6.2, DS #346: `.article-list-item`, `.shelf-book`): an item has no hidden base state, so it shows
// at rest and still shows when its entry animation never runs. The site's own `.article-list-item { opacity: 1; }` override guarded the
// second case until web 4.6.2 fixed it at the source; this check is what the removal rests on.
import {expect, type Locator} from '@playwright/test'

/** Every row in `rows` computes `opacity: 1` at rest, and again once each row's animations are cancelled. */
export async function expectRowsFailVisible(rows: Locator, label: string): Promise<void> {
  const count = await rows.count()
  expect(count, `${label}: rows to check`).toBeGreaterThan(0)
  for (let index = 0; index < count; index++) {
    await expect(rows.nth(index), `${label}: row ${index} at rest`).toHaveCSS('opacity', '1')
  }
  // A cancelled animation leaves the base style, so a `forwards` or `both` fill cannot hold a hidden
  // base at opacity 1 here. The base style is what a browser shows when the keyframes never load.
  const unanimated = await rows.evaluateAll((elements) =>
    elements.map((element) => {
      for (const animation of element.getAnimations()) {
        animation.cancel()
      }
      return getComputedStyle(element).opacity
    })
  )
  expect(unanimated, `${label}: each row's opacity with its entry animation cancelled`).toEqual(Array(count).fill('1'))
}
