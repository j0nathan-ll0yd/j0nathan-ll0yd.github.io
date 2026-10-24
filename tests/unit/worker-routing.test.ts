import {existsSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {INTERNAL_ASSET_PATHS} from '../../src/lib/composed/paths'
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
  kv_namespaces?: {binding: string; id: string}[]
  assets: {binding: string; html_handling: string; not_found_handling: string; run_worker_first: string[]}
  [key: string]: unknown
}

/** wrangler.jsonc with its whole-line comments removed. The file carries no trailing comments. */
function readWranglerConfig(file = 'wrangler.jsonc'): WranglerConfig {
  const source = readFileSync(resolve(process.cwd(), file), 'utf8')
  const json = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  return JSON.parse(json) as WranglerConfig
}

const config = readWranglerConfig()
const limiterConfig = readWranglerConfig('workers/rate-limiter/wrangler.jsonc')

describe('wrangler.jsonc', () => {
  it('runs the Worker first on every path that runs code, and on nothing else', () => {
    const routePaths = EDGE_ROUTES.flatMap((route) => (route.catchAll ? [route.path, `${route.path}/*`] : [route.path]))
    // Wrangler rejects a rule another rule makes redundant ("rule '/api/*' makes it redundant"), so a
    // path under a catch-all glob is covered by that glob and not listed itself.
    const globs = routePaths.filter((path) => path.endsWith('/*')).map((glob) => glob.slice(0, -1))
    const listed = routePaths.filter((path) => !globs.some((prefix) => path !== `${prefix}*` && path.startsWith(prefix)))
    expect(config.assets.run_worker_first).toEqual([...HEADER_OVERRIDE_PATHS, ...listed, ...INTERNAL_ASSET_PATHS])
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(['/api', '/api/*']))
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

  it('declares no binding beyond the static assets, the PAGE namespace and the rate limiter (pinned below)', () => {
    for (const key of ['images', 'r2_buckets', 'd1_databases', 'vars', 'services', 'exports']) {
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
    ['/api/v1', '/api/v1'],
    ['/api/v1/', '/api/v1'],
    ['/api/v1/books.json', '/api/v1'],
    ['/api/v1/nested/books.json', '/api/v1'],
    ['/api', '/api'],
    ['/api/nope', '/api'],
    ['/api/csp-report/extra', '/api'],
    ['/api/v2/books.json', '/api'],
    ['/simple', '/simple'],
    ['/simple/', '/simple'],
    ['/simple/append', '/simple'],
    ['/simple/a/b.gif', '/simple']
  ])('%s reaches %s', (pathname, expected) => {
    expect(matchEdgeRoute(pathname)?.path).toBe(expected)
  })

  it.each(['/', '/privacy', '/llms.txt.bak', '/simpleton', '/apiary', '/llms.txt//'])('%s reaches no route', (pathname) => {
    expect(matchEdgeRoute(pathname)).toBeUndefined()
  })

  it('handles every method on an onRequest route, the CSP collector included (it answers the 405 problem)', () => {
    const llms = matchEdgeRoute('/llms.txt')
    const csp = matchEdgeRoute('/api/csp-report')
    expect(llms && routeHandles(llms, 'PUT')).toBe(true)
    expect(csp && routeHandles(csp, 'POST')).toBe(true)
    expect(csp && routeHandles(csp, 'GET')).toBe(true)
  })

  // covers: developer-api#Every path under /api reaches the Worker
  it('hands every method under /api to the facade, which answers its own 405 problem', () => {
    for (const pathname of ['/api/v1/books.json', '/api/nope', '/api/csp-report']) {
      const route = matchEdgeRoute(pathname)
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE']) {
        expect(route && routeHandles(route, method), `${method} ${pathname}`).toBe(true)
      }
    }
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
      '/api/v1': 'api/v1/[...path].ts',
      '/api': 'api/[...path].ts',
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

describe('wrangler.jsonc: the developer API rate limiter (owner decision 2026-10-24, option B)', () => {
  it('binds the class in the rate-limiter Worker through script_name, with no migration of its own', () => {
    // The binding returned after #399 applied v2: Cloudflare refused the delete twice (error 10061,
    // the #397 and #398 rollouts, 2026-10-24) while any binding existed in the same upload.
    expect(config.durable_objects).toEqual({bindings: [{name: 'API_RATE_LIMITER', class_name: 'ClientRateLimitWindow', script_name: limiterConfig.name}]})
    expect(config.migrations).toEqual([{tag: 'v1', new_sqlite_classes: ['ApiRateLimiter']}, {tag: 'v2', deleted_classes: ['ApiRateLimiter']}])
    // Cloudflare refuses a delete while any binding names the deleted class, whatever its script_name
    // (error 10061, the #397 rollout). The bound class and every deleted class must differ.
    const deleted = (config.migrations as Array<{deleted_classes?: string[]}>).flatMap((step) => step.deleted_classes ?? [])
    for (const binding of (config.durable_objects as {bindings: Array<{class_name: string}>} | undefined)?.bindings ?? []) {
      expect(deleted, binding.class_name).not.toContain(binding.class_name)
    }
    // Durable Object `exports` entries make every `wrangler versions upload` (the PR preview) fail.
    expect(config).not.toHaveProperty('exports')
  })

  it('runs the class in its own Worker, with no route, no assets and no public URL', () => {
    expect(limiterConfig.name).toBe('human-datastream-rate-limiter')
    expect(limiterConfig.main).toBe('./src/index.ts')
    expect(limiterConfig.compatibility_date).toBe(config.compatibility_date)
    expect(limiterConfig.workers_dev).toBe(false)
    expect(limiterConfig.preview_urls).toBe(false)
    // v1 is live (#397); the rename to the class the site binds is a migration, never an edit of v1.
    expect(limiterConfig.migrations).toEqual([
      {tag: 'v1', new_sqlite_classes: ['ApiRateLimiter']},
      {tag: 'v2', renamed_classes: [{from: 'ApiRateLimiter', to: 'ClientRateLimitWindow'}]}
    ])
    for (const key of ['routes', 'route', 'assets', 'durable_objects', 'kv_namespaces', 'vars', 'exports', 'services']) {
      expect(limiterConfig, key).not.toHaveProperty(key)
    }
  })

  it('deploys the rate-limiter Worker before the site Worker, in the same job, failing it on error', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8')
    const limiter = workflow.indexOf('pnpm exec wrangler deploy --config workers/rate-limiter/wrangler.jsonc')
    const site = workflow.indexOf('run: pnpm exec wrangler deploy\n')
    expect(limiter).toBeGreaterThan(0)
    expect(site).toBeGreaterThan(limiter)
    const step = workflow.slice(workflow.lastIndexOf('- name:', limiter), limiter)
    expect(step).not.toMatch(/continue-on-error/)
  })
})

describe('wrangler.jsonc: the published page data (atlas decision 0164)', () => {
  it('binds ONE KV namespace as PAGE, the owner-created human-datastream-page', () => {
    expect(config.kv_namespaces).toEqual([{binding: 'PAGE', id: 'dc9dc20506d1401488e00993370f81b2'}])
  })
})
