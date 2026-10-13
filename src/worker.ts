// The Worker entry (atlas decision 0160, PR A). wrangler.jsonc names it as `main`.
//
// Cloudflare runs this Worker for each path in wrangler.jsonc `run_worker_first` and for each
// path that matches no static file. It reproduces how Pages answered those requests:
//
// 1. The site middleware (src/lib/edge/middleware.ts) wraps every response, as
//    functions/_middleware.ts wrapped every response on the paths Pages routed to Functions.
// 2. A route path reaches its Astro endpoint under the Pages matching rules (src/lib/edge/routes.ts):
//    a trailing slash still matches, and the catch-all still answers its bare directory.
// 3. Every other request goes where the Pages static-asset plane sent it. GET and HEAD reach the
//    Astro handler, which serves the file or the 404 page. Any other method answers 405, empty.
//    These responses carry the static-asset plane's header policy (src/lib/edge/security-headers.ts).
// 4. A code-free path (public/_routes.json excluded it from Functions on Pages) skips the
//    middleware and carries only the static-asset plane's policy, as it did on Pages.

import {handle} from '@astrojs/cloudflare/handler'
import {onRequest as siteMiddleware} from './lib/edge/middleware'
import {matchEdgeRoute, routeHandles} from './lib/edge/routes'
import {ASSET_PLANE_HEADERS, BASE_SECURITY_HEADERS, CSP_HEADERS, isCodeFreePath} from './lib/edge/security-headers'

type AstroEnv = Parameters<typeof handle>[1]
type AstroContext = Parameters<typeof handle>[2]

/** The status and body Pages answered for a method its static-asset plane does not serve. */
function methodNotAllowed(): Response {
  return new Response(null, {status: 405})
}

/**
 * Adds the static-asset plane's headers to a response that the Astro handler took from the
 * ASSETS binding or rendered as the 404 page. `_headers` does not apply to a Worker response.
 */
function withAssetPlaneHeaders(response: Response, codeFree: boolean): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of ASSET_PLANE_HEADERS) {
    headers.set(name, value)
  }
  if (codeFree) {
    for (const [name, value] of BASE_SECURITY_HEADERS) {
      headers.set(name, value)
    }
    // The 404 page reaches here through the ASSETS binding, and `_headers` gave it the CSP trio
    // for its own path. Pages served a code-free path without it.
    for (const [name] of CSP_HEADERS) {
      headers.delete(name)
    }
  }
  // Pages answered its 404 page with no-store, so no cache keeps a 404 for a path that later exists.
  if (response.status === 404) {
    headers.set('Cache-Control', 'no-store')
  }
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
}

/** Routes one request the way Pages routed it, before the middleware wraps the response. */
async function route(request: Request, env: AstroEnv, context: AstroContext, codeFree: boolean): Promise<Response> {
  const url = new URL(request.url)
  const edgeRoute = codeFree ? undefined : matchEdgeRoute(url.pathname)
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
  return withAssetPlaneHeaders(await handle(request, env, context), codeFree)
}

/** The Worker's request handler. */
async function serve(request: Request, env: AstroEnv, context: AstroContext): Promise<Response> {
  const codeFree = isCodeFreePath(new URL(request.url).pathname)
  if (codeFree) {
    return route(request, env, context, true)
  }
  return siteMiddleware({request, next: () => route(request, env, context, false), waitUntil: (promise) => context.waitUntil(promise)})
}

export default {fetch: serve}
