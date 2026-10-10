import {test} from './pw-fixtures'
import {captureFullPage, setupPage, stylePath} from './helpers'

test.describe('Dashboard - populated', () => {
  test.beforeEach(async ({page}) => {
    await setupPage(page, 'populated', {waitForScrollHeight: true})
  })

  test('full page', async ({page}) => {
    await captureFullPage(page, 'dashboard-populated.png', {stylePath})
  })
})

test.describe('Dashboard - empty', () => {
  test.beforeEach(async ({page}) => {
    await setupPage(page, 'empty', {waitForScrollHeight: true})
  })

  test('full page', async ({page}) => {
    await captureFullPage(page, 'dashboard-empty.png', {stylePath})
  })
})

// The DS standard-triad `full` variation: the single maximally-populated dashboard
// scenario (replaces the former `complex` scenario). Like every other dashboard
// scenario, the built page is the data-free shell (atlas decision 0160); the `full`
// data is injected purely via route interception + client re-hydration (helpers.ts
// `interceptRoutes`). See the `full` scenario note in fixtures.ts.
test.describe('Dashboard - full', () => {
  test.beforeEach(async ({page}) => {
    await setupPage(page, 'full', {waitForScrollHeight: true})
  })

  test('full page', async ({page}) => {
    await captureFullPage(page, 'dashboard-full.png', {stylePath})
  })
})
