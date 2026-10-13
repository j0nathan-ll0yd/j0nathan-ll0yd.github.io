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
}

export const EDGE_ROUTES: readonly EdgeRoute[] = Object.freeze([
  {path: '/llms.txt'},
  {path: '/llms-full.txt'},
  {path: '/index.md'},
  {path: '/feed.xml'},
  {path: '/feed.json'},
  {path: '/sa'},
  {path: '/cf-insights.js'},
  {path: '/cf-rum'},
  {path: '/api/csp-report', methods: ['POST']},
  {path: '/simple', catchAll: true}
])

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
