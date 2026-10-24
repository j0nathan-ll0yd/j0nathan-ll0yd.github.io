/**
 * Production smoke check for the dashboard home page.
 *
 * Runs against the LIVE deployed site (https://jonathanlloyd.me) after each
 * Worker deploy. Asserts the page actually loaded and HYDRATED —
 * deterministically, without flaking on the constantly-changing live data
 * stream (GitHub activity, reading feed, movement rings, health values).
 *
 * Why this replaces pixel-drift: an Astro island whose hydration script is
 * CSP-blocked (issue #50) or whose JS chunk 404s still renders its server-side
 * shell at the correct pixel coordinates — so a pixel diff PASSES while the
 * widget is silently dead. The checks below assert hydration RAN, which a
 * pixel diff cannot.
 *
 * Determinism notes:
 *   - Asserts on STRUCTURE and HYDRATION SIGNALS, never on data CONTENT
 *     (counts, values, text of live widgets) — robust to legitimately empty
 *     states (e.g. a day with zero GitHub activity).
 *   - `data-live-ready` on <body> is the same readiness predicate the visual and behavioral
 *     suites use (tests/visual/helpers.ts). The live-data runtime sets it after its first read
 *     and first writes, success or failure, so it proves the runtime executed without throwing.
 *     The poll status dot leaving its server-rendered `off` state proves the first read ran.
 *   - CSP-violation and chunk-load assertions live in the fixture teardown
 *     (tests/smoke/fixtures.ts) and run automatically for every test.
 */
import {createRequire} from 'node:module'
import {expect, test} from './fixtures'
import type {APIRequestContext, APIResponse} from '@playwright/test'
import {probeSuppression, suppressionMessage} from '../../audits/lib/suppression.mjs'
import {findClearEmails} from '../../scripts/check-no-clear-email.mjs'
import {isAllowedImageUrl} from '../image-url-allowlist'

// All navigations use page.goto('/'), resolved against `baseURL` in
// playwright.smoke.config.ts — keep the target URL defined in one place.

/**
 * GET a live endpoint, retrying transient upstream gateway failures (HTTP >= 500)
 * with capped exponential backoff over a ~25s budget.
 *
 * The feed and well-known routes are served through the Worker middleware, which
 * proxies to a CloudFront origin (responses carry `x-source: cloudfront-proxy`).
 * That upstream can emit a one-off 5xx in the seconds after a deploy: smoke run
 * 28675680076 (issue #106) saw feed.json return 502 while every run before and
 * after returned 200. A steady-state 5xx is a real outage and still fails once
 * the budget is spent — this only absorbs a single transient blip, which the
 * whole-test CI retry could not because the upstream error outlived the quick
 * back-to-back retry window.
 */
async function getStable(request: APIRequestContext, url: string, options?: Parameters<APIRequestContext['get']>[1]): Promise<APIResponse> {
  const deadline = Date.now() + 25_000
  let res = await request.get(url, options)
  for (let attempt = 0; res.status() >= 500 && Date.now() < deadline; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(2_000 * 2 ** attempt, 8_000)))
    res = await request.get(url, options)
  }
  return res
}

async function headStable(request: APIRequestContext, url: string): Promise<APIResponse> {
  const deadline = Date.now() + 25_000
  let res = await request.head(url)
  for (let attempt = 0; res.status() >= 500 && Date.now() < deadline; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(2_000 * 2 ** attempt, 8_000)))
    res = await request.head(url)
  }
  return res
}

type SuppressionProbe = Awaited<ReturnType<typeof probeSuppression>>

/**
 * Skips while a focus mode hides gated artifacts, and returns the probe so a failed status
 * assertion can name it. An `indeterminate` probe does not skip: absent evidence never grants a
 * stand-down (atlas decision 0142). The probe reads the backend's focus.json on CloudFront, so it
 * needs the cfedge runner lane; without it every probe was indeterminate and every deploy during
 * a hiding focus failed here on the site's correct 503.
 */
async function skipSuppressedArtifact(label: string): Promise<SuppressionProbe> {
  const result = await probeSuppression()
  expect(result.status, suppressionMessage(result, label)).not.toBe('overdue')
  test.skip(result.status === 'suppressed', suppressionMessage(result, label))
  return result
}

/** The status-assertion message for a gated artifact, naming the focus probe that let the test run. */
function gatedStatusMessage(path: string, probe: SuppressionProbe): string {
  return `${path} did not return 200 (focus probe ${probe.status}: ${probe.reason})`
}

// Server-rendered containers that must always be present. These are structural: present in the
// HTML whatever the live data says. The Worker renders every live card per request in one of its
// honest states (atlas decision 0160, PR B); `@j0nathan-ll0yd/web` 4 renders `#cardWorkouts`
// visible in every state, so it is structural too.
const REQUIRED_CONTAINERS = [
  '#identityCard',
  '#cardBio',
  '#cardSystem',
  '#cardHR',
  '#cardMovement',
  '#cardWorkouts',
  '#cardHydration',
  '#cardSleep',
  '#cardDevLog',
  '#cardReading',
  '#cardStarredRepos',
  '#cardBooks',
  '#cardTheatreReviews'
]

/** The ten live cards: each carries `data-ssr-state` once the Worker renders `/`. */
const LIVE_CARDS = REQUIRED_CONTAINERS.filter((selector) => !['#identityCard', '#cardBio', '#cardSystem'].includes(selector))

test.describe('production home dashboard', () => {
  test('serves 200 and the document shell renders', async ({page}) => {
    const response = await page.goto('/', {waitUntil: 'domcontentloaded'})
    expect(response, 'no response object from navigation').not.toBeNull()
    expect(response!.status(), 'home page did not return HTTP 200').toBe(200)

    // The triptych grid is the structural anchor of the dashboard.
    await expect(page.locator('#triptychGrid')).toBeVisible()
  })

  test('all widget containers are present (SSR shell intact)', async ({page}) => {
    await page.goto('/', {waitUntil: 'domcontentloaded'})
    for (const selector of REQUIRED_CONTAINERS) {
      await expect(page.locator(selector), `required widget container ${selector} missing from SSR output`).toBeAttached()
    }
  })

  test('live-data runtime hydrates (first read done, poll status changed, no throw)', async ({page}) => {
    await page.goto('/', {waitUntil: 'domcontentloaded'})

    // The server render already fills the cards, so a card state proves nothing about the
    // runtime. The runtime sets `data-live-ready` after its first read and first writes, and its
    // first read moves the poll dot off the server-rendered `off` state. If the runtime chunk
    // failed to load, neither happens and this times out.
    await expect(page.locator('body'), 'live-data runtime never finished its first read -- the hydration runtime likely failed to load').toHaveAttribute(
      'data-live-ready',
      '1',
      {timeout: 20_000}
    )
    await expect(page.locator('.poll-dot'), 'the poll status never left its server-rendered state').not.toHaveClass(/poll-dot--off/)
  })

  test('/ is server-rendered: the summary header equals the meta and no live card is loading', async ({page}) => {
    // Holds on production once the Worker renders `/` (atlas decision 0160, PR B). `fallback`
    // (the render missed its ceiling) and `error` fail on purpose: the cards would be data-free.
    const response = await page.goto('/', {waitUntil: 'domcontentloaded'})
    const summary = response!.headers()['x-ssr-data']
    expect(summary, 'X-SSR-Data header missing: the Worker did not render /').toBeTruthy()
    expect(['live', 'stale', 'partial', 'unavailable', 'suppressed'], `X-SSR-Data was "${summary}"`).toContain(summary)
    await expect(page.locator('meta[name="ssr-data"]')).toHaveAttribute('content', summary)

    for (const selector of LIVE_CARDS) {
      await expect(page.locator(selector), `${selector} data-ssr-state`).toHaveAttribute('data-ssr-state', /^(live|empty|stale|unavailable|suppressed)$/)
    }
  })

  test('bio terminal hydrates and types its content (#50 regression guard)', async ({page}) => {
    await page.goto('/', {waitUntil: 'domcontentloaded'})

    // Desktop reveals terminal lines via a typewriter animation driven by the
    // bio-terminal init script (the exact script CSP-blocked in #50). Scroll the
    // card into view so the IntersectionObserver fires, then assert the last
    // line becomes `.visible`. If the init script is blocked, no line ever gains
    // `.visible` and this fails — deterministically catching the #50 class.
    const bio = page.locator('#cardBio')
    await expect(bio).toBeAttached()
    await bio.scrollIntoViewIfNeeded()

    await page.waitForFunction(() => {
      const lines = document.querySelectorAll('#terminalBody .terminal-line')
      if (lines.length === 0) {
        return false
      }
      return lines[lines.length - 1].classList.contains('visible')
    }, {timeout: 20_000})

    // Belt-and-suspenders: the typed output must be non-empty. In #50 the body
    // rendered blank, so this is a second, content-level proof hydration ran.
    const typedText = (await bio.locator('#terminalBody').innerText()).trim()
    expect(typedText.length, 'bio terminal body is empty after hydration').toBeGreaterThan(0)
  })

  test('service worker actively controls the page with /sw.js', async ({page}) => {
    await page.goto('/', {waitUntil: 'load'})

    // skipWaiting + clientsClaim must take the cold page through activation and
    // control. A registration alone is insufficient: an installed-but-idle SW
    // cannot serve the offline shell or drive controllerchange updates.
    const controllerUrl = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) {
        return null
      }
      await navigator.serviceWorker.ready
      const deadline = Date.now() + 35_000
      while (!navigator.serviceWorker.controller && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250))
      }
      return navigator.serviceWorker.controller?.scriptURL ?? null
    })

    expect(controllerUrl, 'no active service worker controller claimed the page within 35s').not.toBeNull()
    expect(controllerUrl).toMatch(/\/sw\.js$/)
  })

  test('hydration and scroll issue no non-allowlisted image requests', async ({page}) => {
    const imageRequests: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() === 'image') {
        imageRequests.push(request.url())
      }
    })

    await page.goto('/', {waitUntil: 'domcontentloaded'})
    await expect(page.locator('body')).toHaveAttribute('data-live-ready', '1', {timeout: 20_000})
    await page.evaluate(async () => {
      const scrollables = [document.scrollingElement, ...document.querySelectorAll<HTMLElement>('*')].filter((element): element is HTMLElement =>
        Boolean(element && element.scrollHeight > element.clientHeight)
      )
      for (const element of scrollables) {
        element.scrollTop = element.scrollHeight
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    })
    await page.waitForTimeout(1000)

    const offenders = [...new Set(imageRequests)].filter((url) => !isAllowedImageUrl(url))
    expect(offenders, `non-allowlisted image requests:\n${offenders.join('\n')}`).toEqual([])
  })

  test('humans.txt is reachable and plain text', async ({page}) => {
    const res = await getStable(page.request, '/humans.txt')
    expect(res.status(), '/humans.txt did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/humans.txt wrong content-type').toContain('text/plain')
  })

  test('feed.xml is reachable and RSS content-type', async ({page}) => {
    const probe = await skipSuppressedArtifact('/feed.xml smoke assertion')
    const res = await getStable(page.request, '/feed.xml')
    expect(res.status(), gatedStatusMessage('/feed.xml', probe)).toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/feed.xml wrong content-type').toContain('application/rss+xml')
  })

  test('feed.json is reachable and JSON Feed content-type', async ({page}) => {
    const probe = await skipSuppressedArtifact('/feed.json smoke assertion')
    const res = await getStable(page.request, '/feed.json')
    expect(res.status(), gatedStatusMessage('/feed.json', probe)).toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/feed.json wrong content-type').toContain('application/feed+json')
  })

  test('llms.txt is reachable and plain text', async ({page}) => {
    const probe = await skipSuppressedArtifact('/llms.txt smoke assertion')
    const res = await getStable(page.request, '/llms.txt')
    expect(res.status(), gatedStatusMessage('/llms.txt', probe)).toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/llms.txt wrong content-type').toContain('text/plain')
  })

  test('llms-full.txt is reachable on the prod domain and markdown', async ({page}) => {
    const probe = await skipSuppressedArtifact('/llms-full.txt smoke assertion')
    // Regression guard: until 2026-07-17 only /llms.txt had a proxy route, so
    // the full dump the discovery index advertises 404'd on jonathanlloyd.me.
    const res = await getStable(page.request, '/llms-full.txt')
    expect(res.status(), gatedStatusMessage('/llms-full.txt', probe)).toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/llms-full.txt wrong content-type').toContain('text/markdown')
  })

  test('index.md is reachable on the prod domain and markdown', async ({page}) => {
    const probe = await skipSuppressedArtifact('/index.md smoke assertion')
    const res = await getStable(page.request, '/index.md')
    expect(res.status(), gatedStatusMessage('/index.md', probe)).toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/index.md wrong content-type').toContain('text/markdown')
  })

  test('og-image responds to HEAD as PNG', async ({page}) => {
    const res = await headStable(page.request, '/assets/og-image.png')
    expect(res.status(), '/assets/og-image.png HEAD did not return 200').toBe(200)
    expect(res.headers()['content-type'] || '', '/assets/og-image.png wrong content-type').toContain('image/png')
  })

  test('webfinger resolves the Fediverse alias with JRD content-type', async ({page}) => {
    // Accept: application/jrd+json is the correct request header for a JRD resource, and it is
    // sent for that reason alone. It does NOT avoid a markdown early-return: middleware
    // negotiation has been homepage-only since PR #288 (`url.pathname === '/'`), so
    // /.well-known/webfinger cannot negotiate whatever the Accept header says. The old comment
    // described the pre-#288 middleware that negotiated on every path (atlas decision 0142 phase 7).
    const res = await getStable(page.request, '/.well-known/webfinger?resource=acct:jonathan@jonathanlloyd.me', {headers: {Accept: 'application/jrd+json'}})
    expect(res.status(), '/.well-known/webfinger did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, 'webfinger wrong content-type').toContain('application/jrd+json')
    const body = await res.json()
    expect(body.subject, 'webfinger subject mismatch').toBe('acct:jonathan@jonathanlloyd.me')
    // The self link is what makes aliasing work; assert it on the LIVE path too,
    // not just the build artifact, to catch a stale/edge-cached deploy.
    const self = body.links?.find((l: {rel: string; href?: string}) => l.rel === 'self')
    expect(self?.href, 'webfinger self link must target the canonical Mastodon actor').toBe('https://mastodon.social/ap/users/116794886250734590')
  })

  test('api-catalog is reachable and linkset content-type', async ({page}) => {
    // Regression guard for the adjacent middleware override edited alongside the
    // webfinger block (currently otherwise untested).
    const res = await getStable(page.request, '/.well-known/api-catalog')
    expect(res.status(), '/.well-known/api-catalog did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, 'api-catalog wrong content-type').toContain('application/linkset+json')
  })

  test('Trusted Types telemetry ships as a report-only header', async ({page}) => {
    // The report-only policy is non-enforcing; it only drains DOM injection-sink
    // violations to /api/csp-report. Assert it reaches the browser on the live path
    // (set unconditionally in src/lib/edge/middleware.ts alongside the enforced CSP).
    const res = await getStable(page.request, '/')
    expect(res.status(), 'home page did not return 200').toBe(200)
    const reportOnly = res.headers()['content-security-policy-report-only'] || ''
    expect(reportOnly, 'Trusted Types report-only header missing').toContain("require-trusted-types-for 'script'")
  })

  test('Content-Usage preference covers representative site content', async ({page}) => {
    for (const path of ['/', '/privacy', '/about', '/contact', '/developers', '/robots.txt']) {
      const res = await getStable(page.request, path)
      expect(res.status(), `${path} did not return HTTP 200`).toBe(200)
      expect(res.headers()['content-usage'], `${path} has the wrong Content-Usage header`).toBe('train-ai=n, search=y')
    }
  })

  test('version.json reports the deployed build', async ({page}) => {
    const res = await getStable(page.request, '/version.json')
    expect(res.status(), '/version.json did not return HTTP 200').toBe(200)

    const body = await res.json()
    expect(typeof body.build, 'version.json missing a build string').toBe('string')
    expect(body.build.length, 'version.json build is empty').toBeGreaterThan(0)

    // When the smoke workflow passes the just-deployed commit (EXPECTED_BUILD =
    // workflow_run.head_sha), assert the LIVE origin actually serves it. Catches a
    // silently-stale / failed deploy — a class the hydration checks above cannot
    // detect (the old build hydrates fine). Skipped on manual/local runs where
    // EXPECTED_BUILD is unset.
    const expected = process.env.EXPECTED_BUILD
    if (!expected) {
      return
    }

    // Rapid successive deploys: if a NEWER deploy landed between this deploy and
    // this smoke run (e.g. two PRs merged minutes apart), the origin correctly
    // serves the newer build, not `expected`. That is a forward supersession, not
    // a failed deploy, so it must pass. We distinguish it from a genuinely
    // stale/rolled-back OLDER build by `builtAt`: EXPECTED_BUILT_AFTER is this
    // deploy's workflow start time (workflow_run.run_started_at), and every build
    // this deploy (or any later one) produces has builtAt >= that instant, while a
    // stale older build's builtAt predates it. Unset (older workflow / manual
    // dispatch) => strict exact-match, preserving the original behavior.
    const builtAfterMs = Date.parse(process.env.EXPECTED_BUILT_AFTER ?? '')
    const acceptsNewer = !Number.isNaN(builtAfterMs)

    // On Pages, version.json was edge-cached (`Cache-Control: max-age=600`) and the
    // deploy did NOT purge the Cloudflare cache, so the EDGE kept serving the
    // PREVIOUS build for up to ~10 min post-deploy. Issue #106 (smoke run
    // 28675680076): expected 46e1db3 but the edge served the prior e692457 for the
    // whole run. On Workers (atlas decision 0160) version.json runs the Worker
    // first and the middleware sets `max-age=0, no-store` (src/lib/edge/middleware.ts),
    // but the Worker reads it from the ASSETS binding, whose headers pass through
    // (src/worker.ts fromAssets), and that response still reported
    // `cf-cache-status: HIT` on 2026-10-16 UTC. So the cache-busted poll stays: a unique
    // `?cb=` per attempt plus a `no-cache` request header, so this asserts the
    // deployed build, tolerating a bounded propagation lag. A deploy that never
    // lands still fails once the budget is spent.
    test.setTimeout(90_000)
    await expect.poll(async () => {
      const fresh = await page.request.get(`/version.json?cb=${Date.now()}`, {headers: {'Cache-Control': 'no-cache'}})
      if (fresh.status() !== 200) {
        return false
      }
      const live = await fresh.json()
      if (live.build === expected) {
        return true
      }
      // Accept a NEWER superseding deploy (builtAt at/after this deploy started),
      // never an older/stale one. See the comment above.
      return (
        acceptsNewer && typeof live.builtAt === 'string' && Date.parse(live.builtAt) >= builtAfterMs
      )
    }, {
      message: 'live origin never served the just-deployed build (or a newer superseding build) within the propagation window',
      timeout: 60_000,
      intervals: [2_000, 3_000, 5_000]
    }).toBe(true)
  })
})

// Email obfuscation on SERVED bytes (atlas decision 0158: obfuscation stays). On Pages, Cloudflare's
// zone Email Address Obfuscation rewrote the HTML at the edge; on Workers (decision 0160) it stopped,
// and production served the address in clear for a day without any check noticing, because the
// parity checks compared two hosts without zone features. The build now encodes every address
// (src/lib/email/), and these tests watch the bytes a visitor actually receives. The detector is the
// postbuild gate's own: it admits the organization's contact alias inside the JSON-LD block and
// nothing else (owner rulings 2026-10-24).
const copyRequire = createRequire(import.meta.url)
const identity = copyRequire('@j0nathan-ll0yd/copy/identity.flat.json') as {person: {email: string}}
/** Pages that name the address: /privacy, and /contact (decision 0158 W2). */
const OBFUSCATED_PAGES = ['/privacy', '/contact']

test.describe('email obfuscation on served pages', () => {
  for (const path of OBFUSCATED_PAGES) {
    test(`${path} serves no email address in clear, and the browser decodes the link`, async ({page}) => {
      const res = await getStable(page.request, `${path}?cb=${Date.now()}`, {headers: {'Cache-Control': 'no-cache'}})
      expect(res.status(), `${path} did not return HTTP 200`).toBe(200)
      const html = await res.text()
      expect(findClearEmails(html), `${path} served an email address or a mailto: link in clear`).toEqual([])
      expect(html, `${path} carries no encoded address`).toContain('data-email="')

      await page.goto(path)
      const link = page.locator(`a[href="mailto:${identity.person.email}"]`).first()
      await expect(link, 'the decoder did not turn the encoded address into a mailto link').toBeVisible()
      await expect(link).toHaveText(identity.person.email)
      await expect(page.locator('a[data-email]'), 'an encoded link was left undecoded').toHaveCount(0)
    })
  }
})
