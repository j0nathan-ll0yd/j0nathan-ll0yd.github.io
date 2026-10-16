// The Worker entry (atlas decision 0160, PR A). wrangler.jsonc names it as `main`.
//
// Cloudflare runs this Worker for each path in wrangler.jsonc `run_worker_first` and for each
// path that matches no static file. It reproduces how Pages answered those requests:
//
// 1. The site middleware (src/lib/edge/middleware.ts) wraps every response, as
//    functions/_middleware.ts wrapped every response on the paths Pages routed to Functions.
// 2. A route path reaches its Astro endpoint under the Pages matching rules (src/lib/edge/routes.ts):
//    a trailing slash still matches, and the catch-all still answers its bare directory.
// 3. Every other request goes where the Pages static-asset plane sent it. GET and HEAD go to the
//    ASSETS binding, which serves the file, or the Worker serves the 404 page. Any other method
//    answers 405, empty. Astro handles only the route endpoints. These responses carry the
//    static-asset plane's header policy (src/lib/edge/security-headers.ts).
// 4. A code-free path (public/_routes.json excluded it from Functions on Pages) skips the
//    middleware and carries only the static-asset plane's policy, as it did on Pages.
// 5. `GET /` is the server render of the dashboard (atlas decision 0160, PR B): the Worker renders
//    src/pages/ssr-dashboard.astro under the D2 budget (src/lib/data-plane/ssr-response.ts). `HEAD /`
//    answers from the prerendered data-free page and reads no data.
// 6. On a loopback host only (a local `astro preview` or `wrangler dev`), the analytics routes
//    answer 404, as the static preview did before PR A, so no test run reaches an upstream.

import {handle} from '@astrojs/cloudflare/handler'
import {onRequest as siteMiddleware} from './lib/edge/middleware'
import {isLocalAnalyticsRequest, matchEdgeRoute, routeHandles} from './lib/edge/routes'
import {type DashboardRenderDeps, headDashboard, renderDashboard} from './lib/data-plane/ssr-response'
import {ASSET_PLANE_HEADERS, BASE_SECURITY_HEADERS, CSP_HEADERS, isCodeFreePath, withUtf8Charset} from './lib/edge/security-headers'

type AstroEnv = Parameters<typeof handle>[1]
type AstroContext = Parameters<typeof handle>[2]

/** The static-asset binding: wrangler.jsonc `assets.binding`. */
interface AssetsBinding {
  fetch(input: Request | URL | string): Promise<Response>
}
type WorkerEnv = AstroEnv & {ASSETS: AssetsBinding}

/** The 404 page, as the build writes it (src/pages/404.astro). */
const NOT_FOUND_PAGE_PATH = '/404'

/** The status and body Pages answered for a method its static-asset plane does not serve. */
function methodNotAllowed(): Response {
  return new Response(null, {status: 405})
}

/**
 * Adds the static-asset plane's headers to a response the Worker took from the ASSETS binding.
 * Pages added them to every static-asset response; a Worker response gets none from `_headers`.
 */
function withAssetPlaneHeaders(response: Response, codeFree: boolean): Response {
  const headers = new Headers(response.headers)
  // Pages served text types with charset=utf-8; the Workers asset server drops it.
  const contentType = withUtf8Charset(headers.get('Content-Type'))
  if (contentType !== null) {
    headers.set('Content-Type', contentType)
  }
  for (const [name, value] of ASSET_PLANE_HEADERS) {
    headers.set(name, value)
  }
  if (codeFree) {
    for (const [name, value] of BASE_SECURITY_HEADERS) {
      headers.set(name, value)
    }
    // The 404 page comes through the ASSETS binding, which can apply `_headers` for its own path
    // and so add the CSP trio. Pages served a code-free path without it.
    for (const [name] of CSP_HEADERS) {
      headers.delete(name)
    }
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
}

/**
 * Serves a GET or HEAD the way the Pages static-asset plane did. The request itself goes to the
 * ASSETS binding, so its method and its conditional and Range headers reach the asset server (a 304
 * stays a 304, a HEAD stays bodiless). A path with no file gets the 404 page with status 404,
 * no-store, and no ETag, as Pages answered it. Astro never sees these requests: its router would
 * redirect an unknown `/x/` (trailing slash) and reject a malformed escape with 400, where Pages
 * answered 404.
 */
async function fromAssets(request: Request, env: WorkerEnv, codeFree: boolean): Promise<Response> {
  const asset = await env.ASSETS.fetch(request)
  if (asset.status !== 404) {
    return withAssetPlaneHeaders(asset, codeFree)
  }
  const page = await env.ASSETS.fetch(new URL(NOT_FOUND_PAGE_PATH, request.url))
  const headers = new Headers(page.headers)
  headers.delete('ETag')
  headers.set('Cache-Control', 'no-store')
  const body = request.method === 'HEAD' ? null : page.body
  return withAssetPlaneHeaders(new Response(body, {status: 404, headers}), codeFree)
}

/** The server render's two dependencies: Astro and the static-asset plane. */
function dashboardDeps(request: Request, env: WorkerEnv, context: AstroContext): DashboardRenderDeps {
  return {render: (rendered) => handle(rendered, env, context), asset: (path, method) => env.ASSETS.fetch(new Request(new URL(path, request.url), {method}))}
}

/** Routes one request the way Pages routed it, before the middleware wraps the response. */
async function route(request: Request, env: WorkerEnv, context: AstroContext, codeFree: boolean): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/' && !codeFree) {
    if (request.method === 'GET') {
      return renderDashboard(request, dashboardDeps(request, env, context))
    }
    if (request.method === 'HEAD') {
      return headDashboard(dashboardDeps(request, env, context))
    }
  }
  const edgeRoute = codeFree ? undefined : matchEdgeRoute(url.pathname)
  if (edgeRoute && isLocalAnalyticsRequest(edgeRoute, url)) {
    // Local runs only (see isLocalAnalyticsRequest): no test page may reach an analytics upstream.
    return new Response('Not found', {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}})
  }
  if (edgeRoute && routeHandles(edgeRoute, request.method)) {
    // Astro matches the route path exactly; Pages also matched it with a trailing slash.
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1)
      return handle(new Request(url, request), env, context)
    }
    return handle(request, env, context)
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withAssetPlaneHeaders(methodNotAllowed(), codeFree)
  }
  return fromAssets(request, env, codeFree)
}

/** The Worker's request handler. */
async function serve(request: Request, env: WorkerEnv, context: AstroContext): Promise<Response> {
  const codeFree = isCodeFreePath(new URL(request.url).pathname)
  if (codeFree) {
    return route(request, env, context, true)
  }
  return siteMiddleware({request, next: () => route(request, env, context, false), waitUntil: (promise) => context.waitUntil(promise)})
}

export default {fetch: serve}
