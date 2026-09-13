import {describe, expect, it} from 'vitest'
import {readFileSync} from 'fs'
import path from 'path'
import {CSP} from '../../functions/_middleware'

// audits/checks/b7-check-headers.mjs diffs the golden against the LIVE site, which
// only reports after a deploy. These tests bind the golden to the middleware
// that generates it, so a one-sided edit fails before the change ships.
const GOLDEN_PATH = path.resolve(process.cwd(), 'audits/fixtures/golden/csp.txt')

// atlas decision 0086 (W3): the backend serves first-party CloudFront images and
// @j0nathan-ll0yd/web falls back to the same-origin /images/no-cover.svg, so no
// image path can reach a third-party host. Re-adding any of these to img-src
// would silently restore the hot-linking this policy exists to prevent.
const REMOVED_IMAGE_HOSTS = ['https://m.media-amazon.com', 'https://images.squarespace-cdn.com', 'https://books.google.com']

const EXPECTED_IMG_SRC = "img-src 'self' data: https://*.basemaps.cartocdn.com https://d1pfm520aduift.cloudfront.net"

function directive(csp: string, name: string): string {
  const found = csp.split(';').map((d) => d.trim()).find((d) => d === name || d.startsWith(`${name} `))
  if (!found) {
    throw new Error(`CSP has no ${name} directive: ${csp}`)
  }
  return found
}

describe('CSP golden baseline', () => {
  const golden = readFileSync(GOLDEN_PATH, 'utf-8').trim()

  it('the golden baseline matches the middleware that generates it', () => {
    expect(golden).toBe(CSP)
  })

  it('img-src is exactly self, data:, carto tiles and first-party CloudFront', () => {
    expect(directive(CSP, 'img-src')).toBe(EXPECTED_IMG_SRC)
    expect(directive(golden, 'img-src')).toBe(EXPECTED_IMG_SRC)
  })

  it.each(REMOVED_IMAGE_HOSTS)('%s appears nowhere in the policy', (host) => {
    expect(CSP).not.toContain(host)
    expect(golden).not.toContain(host)
  })

  // The shrink is scoped to img-src. connect-src carries the CloudFront origin
  // and the API Gateway WebSocket, both still required for live data.
  it('connect-src still carries CloudFront and the WebSocket origin', () => {
    const connectSrc = directive(CSP, 'connect-src')
    expect(connectSrc).toContain('https://d1pfm520aduift.cloudfront.net')
    expect(connectSrc).toContain('wss://')
  })
})
