// The routes that run code (atlas decision 0160, plan Steps 0.5 and 3.2). Each was a Pages
// Function under functions/ and is now an on-demand Astro endpoint under src/pages/.
//
// src/worker.ts reads EDGE_ROUTES to keep the Pages routing rules that Astro does not share:
// a Pages Function route also answered its path with a trailing slash, the `[[path]]`
// catch-all also answered its bare directory, and a method that a route does not handle
// fell through to the static-asset plane. wrangler.jsonc `run_worker_first` lists every
// path below; tests/unit/worker-routing.test.ts pins the two lists together.

import type {APIContext, APIRoute} from 'astro'

export interface EdgeRoute {
  /** The route path, as the Pages Function file named it. */
  readonly path: string
  /** True for a `[[path]]` catch-all: it also answers every path below `path`. */
  readonly catchAll?: boolean
  /** The methods the route handles. Absent: every method (a Pages `onRequest`). */
  readonly methods?: readonly string[]
  /** True for a first-party analytics route: it forwards to Simple Analytics or Cloudflare RUM. */
  readonly analytics?: boolean
}

export const EDGE_ROUTES: readonly EdgeRoute[] = Object.freeze([
  {path: '/llms.txt'},
  {path: '/llms-full.txt'},
  {path: '/index.md'},
  {path: '/feed.xml'},
  {path: '/feed.json'},
  {path: '/sa', analytics: true},
  {path: '/cf-insights.js', analytics: true},
  {path: '/cf-rum', analytics: true},
  {path: '/api/csp-report', methods: ['POST']},
  // The developer API facade (src/lib/edge/api-v1.ts), then every other path under /api, which answers
  // the not-found problem instead of the HTML 404. Both handle every method: the facade answers its
  // own 405 problem. Order matters: matchEdgeRoute takes the first match.
  {path: '/api/v1', catchAll: true},
  {path: '/api', catchAll: true},
  {path: '/simple', catchAll: true, analytics: true},
  // The MCP server and its card (atlas decision 0158). Each handler answers every method itself:
  // /mcp serves POST and answers GET and DELETE 405 with `Allow: POST`; the card serves GET, HEAD
  // and OPTIONS and answers anything else 405.
  {path: '/mcp'},
  {path: '/mcp/server-card'}
])

/**
 * Hostnames that only a local run serves: `astro preview` (the visual and behavioral suites) and
 * `wrangler dev`. Cloudflare never serves one, so no deployed request reaches this branch.
 */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * True when a local run must not reach an analytics upstream. The Simple Analytics script is baked
 * with the production hostname, so a test page that loaded it would record pageviews as
 * jonathanlloyd.me. Before PR A the suites ran on a static preview, where these routes answered 404;
 * src/worker.ts keeps that.
 */
export function isLocalAnalyticsRequest(route: EdgeRoute, url: URL): boolean {
  return route.analytics === true && LOOPBACK_HOSTNAMES.has(url.hostname)
}

/** The route a pathname reaches under the Pages matching rules, or undefined. */
export function matchEdgeRoute(pathname: string): EdgeRoute | undefined {
  const bare = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  return EDGE_ROUTES.find((route) => bare === route.path || (route.catchAll === true && bare.startsWith(`${route.path}/`)))
}

/** True when the route handles this method. */
export function routeHandles(route: EdgeRoute, method: string): boolean {
  return route.methods === undefined || route.methods.includes(method)
}

/** The request context the route handlers take. It keeps the Pages Function context shape. */
export interface EdgeContext {
  request: Request
  params: Record<string, string | string[] | undefined>
  waitUntil(promise: Promise<unknown>): void
}

/** Adapts a Pages-shaped handler to an Astro endpoint. */
export function edgeRoute(handler: (context: EdgeContext) => Response | Promise<Response>): APIRoute {
  return (context: APIContext) =>
    handler({request: context.request, params: context.params, waitUntil: (promise) => context.locals.cfContext.waitUntil(promise)})
}
