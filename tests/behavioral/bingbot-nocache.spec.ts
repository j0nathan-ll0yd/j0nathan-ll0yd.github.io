/**
 * The Microsoft training tag on every page type (atlas decision 0174 B1). Bing has no robots.txt
 * training token: `<meta name="bingbot" content="nocache">` limits Microsoft training and chat
 * answers to URL, title and snippet, and leaves search results unchanged. DOM assertions only.
 *
 * The tag must reach each answer the Worker gives, not only the prerendered files: the composed
 * `/`, the value-free `/`, the data-free `/`, the text pages, the 404 page and the offline page.
 * It sits immediately before the robots meta, the anchor src/lib/composed/shell.ts cuts at.
 */
import {expect, type Page, test} from '@playwright/test'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {resetDataPlane, serveFixtures, setDataPlane} from '../data-plane/control'
import {KNOWN_ANSWER_BY_PATH} from '../data-plane/baseline'

async function expectNocache(page: Page): Promise<void> {
  const bingbot = page.locator('head meta[name="bingbot"]')
  await expect(bingbot).toHaveCount(1)
  await expect(bingbot).toHaveAttribute('content', 'nocache')
  const next = await bingbot.evaluate((meta) => {
    const sibling = meta.nextElementSibling
    return sibling ? `${sibling.tagName.toLowerCase()}[name=${sibling.getAttribute('name')}]` : null
  })
  expect(next, 'the robots meta follows the bingbot meta').toBe('meta[name=robots]')
}

test.describe('bingbot nocache on the server render of /', () => {
  test.use({javaScriptEnabled: false})

  test.beforeEach(async () => {
    await resetDataPlane()
    await serveFixtures(KNOWN_ANSWER_BY_PATH)
  })

  test('the composed page carries it', async ({page}) => {
    const response = await page.goto('/')
    expect(response!.headers()['x-ssr-data']).toBe('live')
    await expectNocache(page)
  })

  test('the value-free page carries it', async ({page}) => {
    await setDataPlane({[ENDPOINTS.focus]: {kind: 'status', status: 500}})
    const response = await page.goto('/')
    expect(response!.headers()['x-ssr-data']).toBe('unavailable')
    await expectNocache(page)
  })

  test('the data-free page carries it', async ({page}) => {
    await setDataPlane({'/dashboard.json': {kind: 'malformed'}})
    const response = await page.goto('/')
    expect(response!.headers()['x-ssr-data']).toBe('fallback')
    await expectNocache(page)
  })
})

test.describe('bingbot nocache on the prerendered pages', () => {
  for (const path of ['/about', '/contact', '/developers', '/privacy', '/offline']) {
    test(`${path} carries it`, async ({page}) => {
      const response = await page.goto(path)
      expect(response!.status()).toBe(200)
      await expectNocache(page)
    })
  }

  test('the 404 page carries it', async ({page}) => {
    const response = await page.goto('/no-such-page-0174')
    expect(response!.status()).toBe(404)
    await expectNocache(page)
  })
})
