// One request's data-plane read and serving clock (atlas decision 0160, PR B). The test seams apply
// here and only here, each only on a preview or loopback host with SSR_FAULT_INJECTION=1
// (./config.ts, ./faults.ts): the fixture data plane (DATA_PLANE_BASE or X-SSR-Data-Plane), the Step
// 6.10 faults and the fixed serving clock.
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {type PageStore, type PublishedRead, readPublished} from '../composed/published'
import {type ComposedRead, readComposed} from '../composed/read'
import type {Shell} from '../composed/shell'
import type {Upstream} from '../edge/proxy'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {BUILD_ID} from './build'
import {DATA_PLANE_BASE_VAR, requestDataPlaneBase} from './config'
import {faultableHost, faultyFetch, FIXTURE_BUILD, fixturePlane, requestClock, requestFault, SSR_CLOCK_HEADER, SSR_FAULT_VAR} from './faults'
import {httpPageStore} from './published-seam'

const HIDING_FOCUS_MODE_SET: ReadonlySet<string> = new Set(HIDING_FOCUS_MODES)

/** The Worker variables the server render reads. */
export type RenderVars = Readonly<Record<string, unknown>>

/** The data plane, transport and build one request reads with: CloudFront and this build, unless a test seam applies. */
function planeForRequest(request: Request, vars: RenderVars): {base: string; upstream: Upstream | undefined; build: string; fixtureOrBase: boolean} {
  const fixture = fixturePlane(request, vars[SSR_FAULT_VAR])
  // A fixture data plane only on a preview or loopback host; production always reads CloudFront.
  const base = fixture?.base ?? requestDataPlaneBase(request, vars[DATA_PLANE_BASE_VAR], faultableHost)
  const fault = requestFault(request, vars[SSR_FAULT_VAR])
  const clock = requestClock(request, vars[SSR_FAULT_VAR])
  // Never the bare global: the proxy calls `upstream.fetch(...)` as a method, and workerd rejects a
  // platform fetch whose receiver is not the global scope (TypeError: Illegal invocation).
  const plain: typeof fetch = fixture?.fetch ?? ((input, init) => fetch(input, init))
  // A fixed test clock travels to a fixture data plane, which composes at the same instant. Only a
  // preview or loopback host with the seams enabled ever has one (requestClock).
  const transport: typeof fetch = clock === null ? plain : (input, init) => {
    const headers = new Headers(init?.headers)
    headers.set(SSR_CLOCK_HEADER, new Date(clock).toISOString())
    return plain(input, {...init, headers})
  }
  const fixtureOrBase = fixture !== null || base !== CLOUDFRONT_BASE
  const testSeam = fixtureOrBase || fault !== null || clock !== null
  const upstream: Upstream | undefined = testSeam ? {base, fetch: fault ? faultyFetch(fault, transport) : transport} : undefined
  // The fixture artifact names FIXTURE_BUILD: no committed file can know the preview's build id.
  return {base, upstream, build: fixture === null ? BUILD_ID : FIXTURE_BUILD, fixtureOrBase}
}

export function readForRequest(request: Request, vars: RenderVars, nowMs: number): Promise<ComposedRead> {
  const {upstream, build} = planeForRequest(request, vars)
  return readComposed({nowMs, build, ...(upstream ? {upstream} : {})})
}

/**
 * One request's read of the published page data (atlas decision 0164): the `PAGE` binding, or, with a
 * fixture data plane (the fixture header or DATA_PLANE_BASE, on a preview or loopback host), that
 * plane's files (./published-seam.ts) through the same fault and clock seams. A fault alone does not
 * switch the store: KV cannot be faulted, so it then reads the binding as production does.
 */
export function readPublishedForRequest(request: Request, vars: RenderVars, page: PageStore, shell: Shell, nowMs: number): Promise<PublishedRead> {
  const {upstream, build, fixtureOrBase} = planeForRequest(request, vars)
  const store = fixtureOrBase && upstream ? httpPageStore(upstream.base, (input, init) => upstream.fetch(input, init)) : page
  return readPublished({store, nowMs, build, shell, hidingModes: HIDING_FOCUS_MODE_SET})
}

/** Date.now(), or the fixed clock a test sends (X-SSR-Clock). */
export function renderClock(request: Request, vars: RenderVars): number {
  return requestClock(request, vars[SSR_FAULT_VAR]) ?? Date.now()
}
