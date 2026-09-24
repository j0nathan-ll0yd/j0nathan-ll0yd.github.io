import {existsSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts'
import {CONTENT_USAGE, LINK_HEADER, onRequest} from '../../functions/_middleware'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discovery Link header', () => {
  it('advertises ARD without advertising an unavailable A2A interface', () => {
    expect(LINK_HEADER).toContain('</.well-known/ai-catalog.json>; rel="ai-catalog"')
    expect(LINK_HEADER).not.toContain('agent-card.json')
    expect(LINK_HEADER).not.toContain('agentcard.org')
  })

  // Nothing pinned rel="describedby" before atlas decision 0142, which is how the markdown
  // alternate in Dashboard.astro drifted to the raw CloudFront origin unnoticed. The address is
  // SITE-RELATIVE on purpose: it resolves through the Pages Function that carries the privacy
  // gate, and the path is derived from the contract's distribution registry rather than spelled.
  it('advertises the llms.txt discovery index at its contract path, site-relative', () => {
    expect(LINK_HEADER).toContain(`<${LLMS_TXT_PATH}>; rel="describedby"; type="text/plain"`)
    expect(LLMS_TXT_PATH).toBe('/llms.txt')
    expect(LINK_HEADER).not.toContain('cloudfront.net')
  })

  it('sets the Link header on the homepage response', async () => {
    const response = await onRequest({request: new Request('https://jonathanlloyd.me/'), next: async () => new Response('html'), waitUntil: () => {}})

    expect(response.headers.get('Link')).toBe(LINK_HEADER)
  })
})

/**
 * THE TWO RESPONSE PLANES (atlas decision 0142 phase 7).
 *
 * Cloudflare applies `public/_headers` ONLY to static asset responses and cache hits;
 * `functions/_middleware.ts` carries the same cross-cutting policy on Pages Function responses.
 * `docs/wiki/Metadata-Files-Spec.md` says the two "must be kept in sync", and until this change
 * that discipline was prose with one header's worth of gate behind it: only Content-Usage was
 * asserted. Editing either plane alone drifted cache-HIT static responses from Function responses
 * with nothing to catch it. Per B10, a convention gets enforced at the highest available tier, and
 * the available tier here is this unit test.
 *
 * The table is DERIVED from the committed `/*` block rather than restated, so a header added to
 * either plane and not the other reds here by construction: a new static header has no Function
 * counterpart to match, and a new Function header is caught by the count assertion below.
 */
/**
 * Walk up from the working directory to the checkout that owns `public/_headers`.
 *
 * NOT `readFileSync('public/_headers')`, and not `import.meta.url` either. The bare relative read
 * this replaces passed only when vitest happened to run from the repo root and threw ENOENT from
 * an editor runner or a subdirectory invocation -- a crash in place of a verdict. `import.meta.url`
 * is not an option here: this suite runs under the jsdom environment, where it resolves against
 * jsdom's http:// base and `fileURLToPath` rejects it.
 */
function headersPath(): string {
  let directory = process.cwd()
  while (!existsSync(resolve(directory, 'public/_headers'))) {
    const parent = dirname(directory)
    expect(parent, 'no ancestor of the working directory contains public/_headers').not.toBe(directory)
    directory = parent
  }
  return resolve(directory, 'public/_headers')
}

function wildcardBlock(): Record<string, string> {
  const staticHeaders = readFileSync(headersPath(), 'utf-8')
  const nextBlock = staticHeaders.indexOf('\n/robots.txt')
  expect(nextBlock, 'public/_headers no longer starts with a /* block followed by /robots.txt').toBeGreaterThan(0)

  const declared: Record<string, string> = {}
  for (const line of staticHeaders.slice(0, nextBlock).split('\n').slice(1)) {
    const at = line.indexOf(':')
    if (at > 0) {
      declared[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
  }
  return declared
}

async function functionResponse(): Promise<Response> {
  return onRequest({request: new Request('https://jonathanlloyd.me/privacy/'), next: async () => new Response('privacy'), waitUntil: () => {}})
}

describe('two-plane response-header parity', () => {
  it('declares exactly the seven cross-cutting headers the middleware also sets', () => {
    // Pinned so ADDING a header to the static plane without the Function plane is a visible diff
    // rather than a silent one-sided edit.
    expect(Object.keys(wildcardBlock()).sort()).toEqual([
      'Content-Usage',
      'Cross-Origin-Opener-Policy',
      'Permissions-Policy',
      'Referrer-Policy',
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options'
    ])
  })

  it('serves every one of them byte-identically on a Pages Function response', async () => {
    const response = await functionResponse()
    const drifted = Object.entries(wildcardBlock()).filter(([name, value]) => response.headers.get(name) !== value).map(([name, value]) =>
      `${name}: static ${JSON.stringify(value)} vs function ${JSON.stringify(response.headers.get(name))}`
    )

    expect(drifted, 'public/_headers and functions/_middleware.ts have drifted apart').toEqual([])
  })
})

describe('Content-Usage response header', () => {
  it('is declared for static asset responses and cache hits', () => {
    expect(wildcardBlock()['Content-Usage']).toBe('train-ai=n, search=y')
    expect(readFileSync(headersPath(), 'utf-8')).not.toMatch(/Content-Signal/i)
  })

  it('is added to normal site responses', async () => {
    const response = await onRequest({
      request: new Request('https://jonathanlloyd.me/privacy/'),
      next: async () => new Response('privacy'),
      waitUntil: () => {}
    })

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(CONTENT_USAGE).toBe('train-ai=n, search=y')
  })

  it('is retained on the negotiated homepage markdown representation', async () => {
    vi.stubGlobal('fetch',
      vi.fn(async (url: string) => url.endsWith('/focus.json') ? new Response(JSON.stringify({currentFocus: 'Personal'})) : new Response('# full profile')))
    const next = vi.fn(async () => new Response('html'))

    const response = await onRequest({request: new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/markdown'}}), next, waitUntil: () => {}})

    expect(response.headers.get('Content-Usage')).toBe(CONTENT_USAGE)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(next).not.toHaveBeenCalled()
  })

  it('suppresses markdown negotiation before fetching the focus-gated artifact', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({currentFocus: 'Work'})))
    vi.stubGlobal('fetch', fetchMock)
    const next = vi.fn(async () => new Response('html'))

    const response = await onRequest({request: new Request('https://jonathanlloyd.me/', {headers: {Accept: 'text/markdown'}}), next, waitUntil: () => {}})

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({suppressed: true, reason: 'focus mode active'})
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(next).not.toHaveBeenCalled()
  })
})
