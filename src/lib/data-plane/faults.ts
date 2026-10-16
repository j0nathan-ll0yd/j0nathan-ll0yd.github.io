// Fault injection for the Step 6.10 measurement (atlas decision 0160, PR B).
//
// Step 6.10 measures the server render on the preview with injected faults: slow reads that force
// the six-connection queue, stalled bodies, 5xx bursts and suppression answers. The preview reads
// the real CloudFront data plane, so the faults are injected in the loader's fetch instead.
//
// Two locks keep this off production:
// 1. The Worker variable SSR_FAULT_INJECTION must be '1'. Only the PR preview upload sets it
//    (`.github/workflows/preview-deploy.yml`); the production deploy job fails when the built config
//    sets it (`scripts/check-deploy-vars.mjs`).
// 2. Even then, only a request to a `*.workers.dev` Version URL or a loopback host is honored. Those
//    hosts sit behind Cloudflare Access or on a developer machine; jonathanlloyd.me never is one.
//
// A fault can only make a read slower or fail. It never adds data to a page.

/** The Worker variable that enables fault injection. Never set in production. */
export const SSR_FAULT_VAR = 'SSR_FAULT_INJECTION'
/** The request header that names the fault for one render. */
export const SSR_FAULT_HEADER = 'X-SSR-Fault'
/**
 * The request header that fixes the render clock for one render (an ISO-8601 instant). The reads stay
 * real; only the `now` the view models judge freshness and relative times against moves. The visual
 * suite uses it so its baselines do not drift with the calendar. Same two locks as a fault.
 */
export const SSR_CLOCK_HEADER = 'X-SSR-Clock'

/** One fault, applied to every gated export read (the focus read is left alone unless named). */
export type Fault =
  | {kind: 'slow'; ms: number}
  | {kind: 'stall'}
  | {kind: 'status'; status: number}
  | {kind: 'suppress'}
  | {kind: 'focus-stall'}

const MAX_SLOW_MS = 10_000
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
const SUPPRESSION_BODY = JSON.stringify({suppressed: true, reason: 'focus mode active'})

/** True when this host may carry a fault: a Workers preview URL or a loopback host. */
export function faultableHost(hostname: string): boolean {
  return hostname.endsWith('.workers.dev') || LOOPBACK_HOSTNAMES.has(hostname)
}

/** Parses `slow:<ms>`, `stall`, `status:<5xx|4xx>`, `suppress` or `focus-stall`; anything else is no fault. */
export function parseFault(value: string | null): Fault | null {
  if (!value) {
    return null
  }
  const [kind, argument] = value.trim().split(':')
  if (kind === 'slow') {
    const ms = Number(argument)
    return Number.isInteger(ms) && ms > 0 && ms <= MAX_SLOW_MS ? {kind: 'slow', ms} : null
  }
  if (kind === 'status') {
    const status = Number(argument)
    return Number.isInteger(status) && status >= 400 && status <= 599 && status !== 403 ? {kind: 'status', status} : null
  }
  if (kind === 'stall' || kind === 'suppress' || kind === 'focus-stall') {
    return {kind}
  }
  return null
}

function testSeamsAllowed(request: Request, enabled: unknown): boolean {
  return enabled === '1' && faultableHost(new URL(request.url).hostname)
}

/** The fault for one request, or null: the variable, the host and the header must all allow it. */
export function requestFault(request: Request, enabled: unknown): Fault | null {
  return testSeamsAllowed(request, enabled) ? parseFault(request.headers.get(SSR_FAULT_HEADER)) : null
}

/** The fixed render clock for one request, in epoch milliseconds, or null (the same locks as a fault). */
export function requestClock(request: Request, enabled: unknown): number | null {
  if (!testSeamsAllowed(request, enabled)) {
    return null
  }
  const value = request.headers.get(SSR_CLOCK_HEADER)?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return null
  }
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function never(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })
}

function delay(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })
}

/**
 * A fetch that applies `fault` to the loader's reads. `slow` and `stall` hold the real connection
 * open (the response arrives, its body is withheld), so they occupy the six-connection queue the
 * way a slow origin does. `status` and `suppress` answer without the network, with CloudFront's
 * `x-amz-cf-id` so the admission rules treat them as gate answers.
 */
export function faultyFetch(fault: Fault, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const isFocus = url.pathname.endsWith('/focus.json')
    const signal = init?.signal
    if (fault.kind === 'focus-stall') {
      return isFocus ? never(signal) : base(input, init)
    }
    if (isFocus) {
      return base(input, init)
    }
    if (fault.kind === 'status') {
      return new Response('injected', {status: fault.status, headers: {'x-amz-cf-id': 'fault-injection'}})
    }
    if (fault.kind === 'suppress') {
      return new Response(SUPPRESSION_BODY, {status: 403, headers: {'content-type': 'application/json', 'x-amz-cf-id': 'fault-injection'}})
    }
    const response = await base(input, init)
    const hold = fault.kind === 'stall' ? never(signal) : delay(fault.ms, signal)
    const body = hold.then(() => response.arrayBuffer())
    // The loader may stop reading at its deadline; the held body then rejects with nobody waiting.
    body.catch(() => {})
    // A Response whose body arrives only after the hold: the connection stays open meanwhile.
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          controller.enqueue(new Uint8Array(await body))
          controller.close()
        } catch (error) {
          controller.error(error)
        }
      }
    }), {status: response.status, statusText: response.statusText, headers: response.headers})
  }
}

/** The request header that reads the fixture data plane (FIXTURE_DATA_PLANE) instead of CloudFront. */
export const SSR_DATA_PLANE_HEADER = 'X-SSR-Data-Plane'

declare const __SSR_FIXTURE_REF__: string | undefined

/**
 * The commit the fixture data plane reads: the PR head the preview was built from
 * (`preview-deploy.yml` sets SSR_FIXTURE_REF), so the fixture always matches the Worker that reads it.
 * Elsewhere `main`. Only a full commit id or `main` is accepted; anything else reads `main`.
 */
export const FIXTURE_REF = typeof __SSR_FIXTURE_REF__ === 'string' && /^(?:[0-9a-f]{40}|main)$/.test(__SSR_FIXTURE_REF__) ? __SSR_FIXTURE_REF__ : 'main'

/**
 * A fixed, public, value-free test location for the Step 6.10 measurement of the serving path: the
 * website repository's own fixture data plane (tests/fixtures/composed/) at FIXTURE_REF, served by
 * GitHub. It holds a focus signal and a composed artifact built from the design system's fixtures,
 * never live data.
 */
export const FIXTURE_DATA_PLANE = `https://raw.githubusercontent.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/${FIXTURE_REF}/tests/fixtures/composed`

/**
 * The fixture data plane for one request, or null (the same two locks as a fault). Its responses
 * carry no `x-amz-cf-id`, so its fetch stamps one: the admission rules then treat the fixture as a
 * gate answer, which is what the measurement exercises.
 */
export function fixturePlane(request: Request, enabled: unknown): {base: string; fetch: typeof fetch} | null {
  if (enabled !== '1' || !faultableHost(new URL(request.url).hostname) || request.headers.get(SSR_DATA_PLANE_HEADER) !== 'fixture') {
    return null
  }
  return {
    base: FIXTURE_DATA_PLANE,
    fetch: async (input, init) => {
      const response = await fetch(input, init)
      const headers = new Headers(response.headers)
      headers.set('x-amz-cf-id', 'fixture-data-plane')
      headers.delete('cf-cache-status')
      return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
    }
  }
}
