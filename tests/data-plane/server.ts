// The fixture data plane (atlas decision 0160, PR B, plan Step 6.2): a small HTTP server that
// answers the nine export paths the way CloudFront does, from raw fixtures, so the Worker's
// server render runs against known inputs. The local `astro preview` reads it through the Worker
// variable DATA_PLANE_BASE (`tests/data-plane/write-dev-vars.mjs`).
//
// Every answer carries `x-amz-cf-id`: the loader refuses a 200 without it. Control endpoints:
//   POST /__control/set    {path, behavior}   replace one path's answer (see ./protocol.ts)
//   POST /__control/reset                     back to the baseline answers
//   GET  /__control/requests                  the export paths read since the last reset
// State is per server. Each Playwright run starts its own server and runs its tests serially.
import {readFileSync} from 'node:fs'
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {mirroredBookCovers} from '../../src/lib/book-cover-mirror'
import {BASELINE_BY_PATH} from './baseline'
import {type Behavior, CONTROL_PREFIX, DEFAULT_PORT, type GeneratedAtMode, SUPPRESSION_BODY} from './protocol'

const PORT = Number(process.env.DATA_PLANE_PORT ?? DEFAULT_PORT)
const DEFAULT_GENERATED_AT: GeneratedAtMode = (process.env.DATA_PLANE_GENERATED_AT as GeneratedAtMode | undefined) ?? 'now'
const EXPORT_PATHS = new Set(Object.values(ENDPOINTS))

let overrides = new Map<string, Behavior>()
let requests: string[] = []

function stamp(body: unknown, mode: GeneratedAtMode): unknown {
  if (mode === 'original' || typeof body !== 'object' || body === null) {
    return body
  }
  const generatedAt = mode === 'now' ? new Date().toISOString() : mode
  return {...(body as Record<string, unknown>), generatedAt}
}

function baselineFor(path: string): Behavior {
  return {kind: 'fixture', file: BASELINE_BY_PATH[path]}
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function send(response: ServerResponse, status: number, body: string, cloudfrontId = true): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...(cloudfrontId ? {'x-amz-cf-id': 'fixture-data-plane'} : {})
  })
  response.end(body)
}

function answer(response: ServerResponse, behavior: Behavior): void {
  switch (behavior.kind) {
    case 'fixture':
      send(response, 200, JSON.stringify(stamp(readJson(behavior.file), behavior.generatedAt ?? DEFAULT_GENERATED_AT)))
      return
    case 'no-cloudfront-id':
      if (behavior.file === undefined) {
        send(response, 500, JSON.stringify({error: 'no-cloudfront-id needs a file outside the composed-artifact path'}))
        return
      }
      send(response, 200, JSON.stringify(stamp(readJson(behavior.file), DEFAULT_GENERATED_AT)), false)
      return
    case 'json':
      send(response, 200, JSON.stringify(stamp(behavior.body, behavior.generatedAt ?? DEFAULT_GENERATED_AT)))
      return
    case 'status':
      send(response, behavior.status, JSON.stringify({error: 'fixture failure'}))
      return
    case 'suppress':
      send(response, 403, JSON.stringify(SUPPRESSION_BODY))
      return
    case 'malformed':
      send(response, 200, '{"generatedAt": ')
      return
    case 'stall':
      // Headers and the first bytes go out; the body never ends. The loader's body deadline fires.
      response.writeHead(200, {'content-type': 'application/json', 'x-amz-cf-id': 'fixture-data-plane'})
      response.write('{"generatedAt":')
      return
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

async function control(request: IncomingMessage, response: ServerResponse, route: string): Promise<void> {
  if (route === '/reset' && request.method === 'POST') {
    overrides = new Map()
    requests = []
    send(response, 200, '{}')
  } else if (route === '/set' && request.method === 'POST') {
    const {path, behavior} = (await readBody(request)) as {path: string; behavior: Behavior}
    if (!EXPORT_PATHS.has(path) && path !== DASHBOARD_PATH) {
      send(response, 400, JSON.stringify({error: `unknown export path ${path}`}))
      return
    }
    overrides.set(path, behavior)
    send(response, 200, '{}')
  } else if (route === '/requests' && request.method === 'GET') {
    send(response, 200, JSON.stringify(requests))
  } else {
    send(response, 404, '{}')
  }
}

/** The test composer: this website's own build of src/lib/composed/compose.ts (scripts/build-composer.mjs). */
const COMPOSER = new URL('../../dist-composer/composer.mjs', import.meta.url)
const DASHBOARD_PATH = '/dashboard.json'
const FIXTURE_NOW = '2026-03-18T12:00:00.000Z'

/** One export's body as the backend composer would read it from the bucket, or null when unreadable. */
function exportBody(path: string): unknown {
  const behavior = overrides.get(path) ?? baselineFor(path)
  switch (behavior.kind) {
    case 'fixture':
      return stamp(readJson(behavior.file), behavior.generatedAt ?? DEFAULT_GENERATED_AT)
    case 'no-cloudfront-id':
      return behavior.file === undefined ? null : stamp(readJson(behavior.file), DEFAULT_GENERATED_AT)
    case 'json':
      return stamp(behavior.body, behavior.generatedAt ?? DEFAULT_GENERATED_AT)
    case 'malformed':
      return {generatedAt: null}
    default:
      return null
  }
}

/**
 * The composed dashboard, composed now from the exports this server answers: what the backend
 * composer publishes after each export update. The gate shuts every gated path at once, so a
 * suppression on any export suppresses the artifact too. A hiding or unreadable focus value publishes
 * nothing (404). The composition clock is the request's X-SSR-Clock (the Worker forwards a test
 * clock), else the fixtures' date when they keep their own stamps, else now.
 */
async function dashboard(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const own = overrides.get(DASHBOARD_PATH)
  // `no-cloudfront-id` with no file: compose as usual, then answer without the CloudFront request id.
  const unproven = own?.kind === 'no-cloudfront-id' && own.file === undefined
  if (own && !unproven) {
    answer(response, own)
    return
  }
  const behaviors = [...EXPORT_PATHS].filter((path) => path !== ENDPOINTS.focus).map((path) => overrides.get(path) ?? baselineFor(path))
  if (behaviors.some((behavior) => behavior.kind === 'suppress')) {
    answer(response, {kind: 'suppress'})
    return
  }
  const {compose} = (await import(COMPOSER.href)) as {compose: (input: unknown) => Promise<{ok: boolean; artifact?: unknown}>}
  const clock = request.headers['x-ssr-clock']
  const nowMs = typeof clock === 'string' ? Date.parse(clock) : DEFAULT_GENERATED_AT === 'original' ? Date.parse(FIXTURE_NOW) : Date.now()
  const keys = Object.entries(ENDPOINTS).filter(([key]) => key !== 'focus')
  const result = await compose({
    exports: Object.fromEntries(keys.map(([key, path]) => [key, exportBody(path)])),
    focus: exportBody(ENDPOINTS.focus),
    nowMs,
    localCovers: mirroredBookCovers(),
    web: JSON.parse(readFileSync(new URL('../../node_modules/@j0nathan-ll0yd/web/package.json', import.meta.url), 'utf8')).version
  })
  if (!result.ok) {
    send(response, 404, '{}')
    return
  }
  send(response, 200, JSON.stringify(result.artifact), !unproven)
}

async function warmComposer(): Promise<void> {
  const {compose} = (await import(COMPOSER.href)) as {compose: (input: unknown) => Promise<unknown>}
  const keys = Object.entries(ENDPOINTS).filter(([key]) => key !== 'focus')
  await compose({
    exports: Object.fromEntries(keys.map(([key, path]) => [key, exportBody(path)])),
    focus: exportBody(ENDPOINTS.focus),
    nowMs: Date.parse(FIXTURE_NOW),
    localCovers: mirroredBookCovers(),
    web: 'warm-up'
  })
}

const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://data-plane.invalid').pathname
  if (path.startsWith(`${CONTROL_PREFIX}/`)) {
    control(request, response, path.slice(CONTROL_PREFIX.length)).catch((error: unknown) => send(response, 500, JSON.stringify({error: String(error)})))
    return
  }
  if (request.method === 'GET' && path === DASHBOARD_PATH) {
    requests.push(path)
    dashboard(request, response).catch((error: unknown) => send(response, 500, JSON.stringify({error: String(error)})))
    return
  }
  if (request.method !== 'GET' || !EXPORT_PATHS.has(path)) {
    send(response, 404, '{}')
    return
  }
  requests.push(path)
  const behavior = overrides.get(path) ?? baselineFor(path)
  if (behavior.delayMs) {
    setTimeout(() => answer(response, behavior), behavior.delayMs)
  } else {
    answer(response, behavior)
  }
})

// Warm the composer before the server answers: its first compose (the module import and the Astro
// container) can take longer than the Worker's 3 s ceiling on a loaded machine, and the first test
// would then see the data-free page instead of the composed one.
await warmComposer()

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[data-plane] listening on http://127.0.0.1:${PORT}`)
})
