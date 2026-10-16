import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {HEADER_OVERRIDE_PATHS} from '../../src/lib/edge/middleware'
import {EDGE_ROUTES, matchEdgeRoute, routeHandles} from '../../src/lib/edge/routes'

// The Worker's routing configuration (atlas decision 0160, PR A; plan Steps 3.1 and 3.5). These
// pins make each owner-gated value a visible diff: preview_urls flips only at gate G3, after the
// owner puts Cloudflare Access on the Worker's Version URLs.

interface WranglerConfig {
  name: string
  main: string
  compatibility_date: string
  compatibility_flags: string[]
  workers_dev: boolean
  preview_urls: boolean
  observability: {enabled: boolean}
  assets: {binding: string; html_handling: string; not_found_handling: string; run_worker_first: string[]}
  [key: string]: unknown
}

/** wrangler.jsonc with its whole-line comments removed. The file carries no trailing comments. */
function readWranglerConfig(): WranglerConfig {
  const source = readFileSync(resolve(process.cwd(), 'wrangler.jsonc'), 'utf8')
  const json = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  return JSON.parse(json) as WranglerConfig
}

const config = readWranglerConfig()

describe('wrangler.jsonc', () => {
  it('runs the Worker first on every path that runs code, and on nothing else', () => {
    const routePaths = EDGE_ROUTES.flatMap((route) => (route.catchAll ? [route.path, `${route.path}/*`] : [route.path]))
    expect(config.assets.run_worker_first).toEqual([...HEADER_OVERRIDE_PATHS, ...routePaths])
  })

  it('sends an unmatched path to the Worker, which renders the 404 page through the middleware', () => {
    expect(config.assets.not_found_handling).toBe('none')
    expect(config.assets.html_handling).toBe('auto-trailing-slash')
    expect(config.assets.binding).toBe('ASSETS')
  })

  it('keeps one compatibility date and flag set for production and previews', () => {
    // The production Pages date. 2024-11-11 is the floor: the fetch `cache` option needs it.
    expect(config.compatibility_date).toBe('2026-05-06')
    expect(config.compatibility_date >= '2024-11-11').toBe(true)
    expect(config.compatibility_flags).toEqual(['nodejs_compat'])
    expect(config).not.toHaveProperty('env')
  })

  it('exposes no public hostname: no workers.dev alias; Version URLs only behind Access (gate G3)', () => {
    expect(config.workers_dev).toBe(false)
    expect(config.preview_urls).toBe(true)
    expect(config).not.toHaveProperty('route')
  })

  it('declares no route: the production route lives in Cloudflare, so CI deploys never reset its fail-open (owner decision 2026-10-14)', () => {
    expect(config).not.toHaveProperty('routes')
  })

  // covers: llms-txt#Canonical llms responses always pass through the privacy gate
  it('enables no Workers Caching: the Worker answers ahead of every Cloudflare cache', () => {
    // With `cache.enabled`, Cloudflare checks a cache BEFORE running the Worker and answers a hit
    // without it (developers.cloudflare.com/workers/cache/). That would replay a stored LLM document
    // past the proxy's focus gate, and the B2 llms check would see CF-Cache-Status on the site plane
    // (audits/checks/b2-llms.mjs siteEdgeCacheFailure).
    expect(config).not.toHaveProperty('cache')
  })

  it('declares no binding beyond the static assets', () => {
    for (const key of ['kv_namespaces', 'images', 'r2_buckets', 'd1_databases', 'vars', 'services', 'durable_objects']) {
      expect(config, key).not.toHaveProperty(key)
    }
    expect(config.observability).toEqual({enabled: true})
    expect(config.main).toBe('./src/worker.ts')
  })

  it('leaves no Pages Functions directory behind, which a Worker would silently ignore', () => {
    expect(existsSync(resolve(process.cwd(), 'functions'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'public/_routes.json'))).toBe(false)
  })
})

describe('matchEdgeRoute (the Pages matching rules)', () => {
  it.each([
    ['/llms.txt', '/llms.txt'],
    ['/llms.txt/', '/llms.txt'],
    ['/api/csp-report', '/api/csp-report'],
    ['/simple', '/simple'],
    ['/simple/', '/simple'],
    ['/simple/append', '/simple'],
    ['/simple/a/b.gif', '/simple']
  ])('%s reaches %s', (pathname, expected) => {
    expect(matchEdgeRoute(pathname)?.path).toBe(expected)
  })

  it.each(['/', '/privacy', '/llms.txt.bak', '/simpleton', '/api', '/api/csp-report/extra', '/llms.txt//'])('%s reaches no route', (pathname) => {
    expect(matchEdgeRoute(pathname)).toBeUndefined()
  })

  it('handles every method on an onRequest route, and only POST on the CSP collector', () => {
    const llms = matchEdgeRoute('/llms.txt')
    const csp = matchEdgeRoute('/api/csp-report')
    expect(llms && routeHandles(llms, 'PUT')).toBe(true)
    expect(csp && routeHandles(csp, 'POST')).toBe(true)
    expect(csp && routeHandles(csp, 'GET')).toBe(false)
  })

  it('names every on-demand endpoint under src/pages exactly once', () => {
    const files: Record<string, string> = {
      '/llms.txt': 'llms.txt.ts',
      '/llms-full.txt': 'llms-full.txt.ts',
      '/index.md': 'index.md.ts',
      '/feed.xml': 'feed.xml.ts',
      '/feed.json': 'feed.json.ts',
      '/sa': 'sa.ts',
      '/cf-insights.js': 'cf-insights.js.ts',
      '/cf-rum': 'cf-rum.ts',
      '/api/csp-report': 'api/csp-report.ts',
      '/simple': 'simple/[...path].ts',
      '/mcp': 'mcp/index.ts',
      '/mcp/server-card': 'mcp/server-card.ts'
    }
    expect(EDGE_ROUTES.map((route) => route.path).sort()).toEqual(Object.keys(files).sort())
    for (const file of Object.values(files)) {
      const source = readFileSync(resolve(process.cwd(), 'src/pages', file), 'utf8')
      expect(source, file).toMatch(/^export const prerender = false$/m)
    }
  })
})
