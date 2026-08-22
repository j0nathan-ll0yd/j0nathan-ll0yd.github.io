/**
 * Production smoke check for the dashboard home page.
 *
 * Runs against the LIVE deployed site (https://jonathanlloyd.me) after each
 * Cloudflare Pages deploy. Asserts the page actually loaded and HYDRATED —
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
 *   - `.is-loading` clearing is the same readiness predicate the visual suite
 *     uses (tests/visual/helpers.ts) — the live-data runtime adds it to live
 *     cards and removes it when each updater runs (or via an 8s fallback), so
 *     reaching zero proves the runtime executed without throwing.
 *   - CSP-violation and chunk-load assertions live in the fixture teardown
 *     (tests/smoke/fixtures.ts) and run automatically for every test.
 */
import {expect, test} from './fixtures'
import type {APIRequestContext, APIResponse} from '@playwright/test'

// All navigations use page.goto('/'), resolved against `baseURL` in
// playwright.smoke.config.ts — keep the target URL defined in one place.

/**
 * GET a live endpoint, retrying transient upstream gateway failures (HTTP >= 500)
 * with capped exponential backoff over a ~25s budget.
 *
 * The feed and well-known routes are served through the Pages middleware, which
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

// Statically server-rendered containers that must always be present. These are
// structural — present in SSR HTML regardless of live data. `#cardWorkouts` is
// intentionally excluded: it starts `display: none` in SSR and is only shown by
// the workouts updater, so its presence is data-dependent, not structural.
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

test.describe('production home dashboard', () => {
  test('raw HTML is edge-composed and contains no fixture-backed live widgets', async ({page}) => {
    const response = await getStable(page.request, '/', {headers: {Accept: 'text/html'}})
    expect(response.status(), 'home page did not return HTTP 200').toBe(200)
    expect(['live', 'partial', 'unavailable']).toContain(response.headers()['x-ssr-data'])

    const html = await response.text()
    expect(html).toContain('id="ssrDashboardSnapshot"')
    expect(html).toContain('<meta name="ssr-data"')
    expect(html).toContain('data-location-export="excluded"')
    expect(html).not.toContain('id="cardHR"')
    expect(html).not.toContain('id="cardDevLog"')
    expect(html).not.toContain('id="cardReading"')
    expect(html).not.toContain('id="cardBooks"')
    expect(html).not.toContain('Unify handler pattern')
    expect(html).not.toContain('Why SQLite Is So Great for the Edge')
  })

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

  test('live-data runtime hydrates (skeletons clear, no throw)', async ({page}) => {
    await page.goto('/', {waitUntil: 'domcontentloaded'})

    // The live-data runtime marks live cards with `is-loading`, then removes it
    // when each updater completes or an 8s fallback fires. If the runtime chunk
    // failed to load, the SSR `is-loading` cards never clear and this times out.
    // This is the same readiness predicate the visual suite relies on.
    await expect.poll(() => page.locator('.is-loading').count(), {
      message: 'live-data runtime never cleared skeleton states — the hydration runtime likely failed to load',
      timeout: 20_000,
      intervals: [500, 1000, 2000]
    }).toBe(0)
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

  test('service worker registers for /sw.js', async ({page}) => {
    await page.goto('/', {waitUntil: 'load'})

    // sw-register.js registers the SW on window `load`. The registration object
    // (with its scriptURL) appears within a few hundred ms via the `installing`
    // state, but full activation can take much longer because the SW precaches
    // assets over the live network (observed up to ~33s on a throttled link). We
    // only need the registration to EXIST, not to be active — and we do NOT
    // require `controller`, which on a cold first load only gets set on the next
    // navigation (clientsClaim timing). Waiting inside a single page.evaluate
    // (returning the instant a registration appears) is more reliable than a
    // cross-process poll and is bounded well under the 45s test timeout.
    const swScriptUrl = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) {
        return null
      }
      const read = async (): Promise<string | null> => {
        const reg = await navigator.serviceWorker.getRegistration()
        return (
          reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? reg?.waiting?.scriptURL ?? null
        )
      }
      const deadline = Date.now() + 35_000
      let url = await read()
      while (!url && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 250))
        url = await read()
      }
      return url
    })

    expect(swScriptUrl, 'no service worker registered for /sw.js within 35s').not.toBeNull()
    expect(swScriptUrl).toMatch(/\/sw\.js$/)
  })

  test('humans.txt is reachable and plain text', async ({page}) => {
    const res = await getStable(page.request, '/humans.txt')
    expect(res.status(), '/humans.txt did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/humans.txt wrong content-type').toContain('text/plain')
  })

  test('feed.xml is reachable and RSS content-type', async ({page}) => {
    const res = await getStable(page.request, '/feed.xml')
    expect(res.status(), '/feed.xml did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/feed.xml wrong content-type').toContain('application/rss+xml')
  })

  test('feed.json is reachable and JSON Feed content-type', async ({page}) => {
    const res = await getStable(page.request, '/feed.json')
    expect(res.status(), '/feed.json did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/feed.json wrong content-type').toContain('application/feed+json')
  })

  test('llms.txt is reachable and plain text', async ({page}) => {
    const res = await getStable(page.request, '/llms.txt')
    expect(res.status(), '/llms.txt did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/llms.txt wrong content-type').toContain('text/plain')
  })

  test('llms-full.txt is reachable on the prod domain and markdown', async ({page}) => {
    // Regression guard: until 2026-07-17 only /llms.txt had a proxy route, so
    // the full dump the discovery index advertises 404'd on jonathanlloyd.me.
    const res = await getStable(page.request, '/llms-full.txt')
    expect(res.status(), '/llms-full.txt did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/llms-full.txt wrong content-type').toContain('text/markdown')
  })

  test('index.md is reachable on the prod domain and markdown', async ({page}) => {
    const res = await getStable(page.request, '/index.md')
    expect(res.status(), '/index.md did not return 200').toBe(200)
    const contentType = res.headers()['content-type'] || ''
    expect(contentType, '/index.md wrong content-type').toContain('text/markdown')
  })

  test('webfinger resolves the Fediverse alias with JRD content-type', async ({page}) => {
    // Accept: application/jrd+json avoids the text/markdown early-return in
    // functions/_middleware.ts that would otherwise short-circuit to llms-full.
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
    // (set unconditionally in functions/_middleware.ts alongside the enforced CSP).
    const res = await getStable(page.request, '/')
    expect(res.status(), 'home page did not return 200').toBe(200)
    const reportOnly = res.headers()['content-security-policy-report-only'] || ''
    expect(reportOnly, 'Trusted Types report-only header missing').toContain("require-trusted-types-for 'script'")
  })

  test('Content-Usage preference covers representative site content', async ({page}) => {
    for (const path of ['/', '/privacy/', '/robots.txt']) {
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

    // version.json is edge-cached (`Cache-Control: max-age=600`) and the deploy
    // does NOT purge the Cloudflare cache, so the EDGE can keep serving the
    // PREVIOUS build for up to ~10 min post-deploy. Issue #106 (smoke run
    // 28675680076): expected 46e1db3 but the edge served the prior e692457 for the
    // whole run, failing every whole-test retry — a plain re-fetch just hits the
    // same cached asset. That stale edge is expected and self-heals; it is NOT a
    // failed deploy. Poll a cache-busted URL instead: a unique `?cb=` per attempt
    // plus a `no-cache` request header force an origin revalidation (verified: the
    // plain URL is a cf-cache HIT while `?cb=<ts>` returns the fresh origin build),
    // so this asserts the ORIGIN published the new build — the real failure mode —
    // while tolerating the bounded edge-propagation lag. A deploy that never lands
    // at origin still fails once the budget is spent.
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
