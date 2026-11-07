import {expect, type Page, test} from '@playwright/test'
import {WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {interceptDashboard, loadDashboard} from './dashboard-fixtures'

// A dashboard test must not reach the production socket: a real focus push could suppress cards in
// the middle of a test. `page.route` does not intercept a WebSocket, so `interceptBrowserOnly` routes
// it with `page.routeWebSocket`. `page.on('websocket')` reports only a socket the browser really opens.

function nativeSockets(page: Page): string[] {
  const urls: string[] = []
  page.on('websocket', (socket) => urls.push(socket.url()))
  return urls
}

test.describe('Live socket in the dashboard fixtures', () => {
  test('the runtime tries the socket once loaded', async ({page}) => {
    let attempts = 0
    await interceptDashboard(page)
    await page.routeWebSocket(WEBSOCKET_URL, () => {
      attempts += 1
    })
    await page.goto('/')
    await expect.poll(() => attempts, {message: 'the runtime opened its socket'}).toBeGreaterThan(0)
  })

  test('the browser opens no socket to the production host', async ({page}) => {
    const urls = nativeSockets(page)
    await loadDashboard(page, {}, '#cardReading')
    // Long enough for the runtime's connect, which the test above proves happens.
    await page.waitForTimeout(1000)
    expect(urls).toEqual([])
  })
})
