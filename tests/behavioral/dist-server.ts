import {createServer, type Server} from 'node:http'
import {readFile} from 'node:fs/promises'
import {extname, join, normalize, posix, resolve} from 'node:path'
import type {AddressInfo} from 'node:net'

// A static server for the BUILT site on 127.0.0.1, for the service-worker behavioral specs.
//
// The suite's shared preview server answers on `localhost` only, and public/js/sw-register.js
// deliberately skips registration on `localhost`, so these specs serve `dist/` themselves. A test
// can override any path (`overrides`), read which paths were requested (`requests`), and make the
// server drop every connection (`down`), which is a real network failure as the worker sees it.

const DIST = resolve(process.cwd(), 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
}

export interface Answer {
  status: number
  type: string
  body: Buffer | string
  /** A redirect target, sent as the Location header. */
  location?: string
}

export interface DistServer {
  origin: string
  /** Paths answered with a fixed response instead of the file in dist/. */
  overrides: Map<string, Answer>
  /** Every pathname requested, in order. */
  requests: string[]
  /** When true, every connection is destroyed without a response. */
  down: boolean
  /**
   * When true, the server decodes the path (`%2F`, `%5C` included), turns backslashes into slashes
   * and resolves dot segments before it answers, as some origins do. `/images/books/..%2F..%2Ffeed.json`
   * then answers as `/feed.json`. Off by default.
   */
  decodePaths: boolean
  close(): Promise<void>
}

export const javascript = (body: string): Answer => ({status: 200, type: MIME['.js'], body})
export const notFound: Answer = {status: 404, type: 'text/plain', body: 'not found'}

async function fromDist(pathname: string): Promise<Answer> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = normalize(join(DIST, relative))
  if (!file.startsWith(DIST)) {
    return {status: 403, type: 'text/plain', body: 'forbidden'}
  }
  // Astro builds `/privacy` and `/offline` as `<name>/index.html` and `/404` as `404.html`
  // (trailingSlash: 'never'), and Workbox precaches them by their extensionless URLs, so resolve
  // the way the production host does.
  for (const candidate of [file, `${file}.html`, join(file, 'index.html')]) {
    try {
      return {status: 200, type: MIME[extname(candidate)] ?? 'application/octet-stream', body: await readFile(candidate)}
    } catch {
      // Try the next candidate.
    }
  }
  return notFound
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export async function startDistServer(): Promise<DistServer> {
  const state = {overrides: new Map<string, Answer>(), requests: [] as string[], down: false, decodePaths: false}
  const server: Server = createServer((request, response) => {
    if (state.down) {
      request.socket.destroy()
      return
    }
    const raw = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const pathname = state.decodePaths ? posix.normalize(safeDecode(raw).replace(/\\/g, '/')) : raw
    state.requests.push(pathname)
    const answer = state.overrides.get(pathname)
    void (answer ? Promise.resolve(answer) : fromDist(pathname)).then(({status, type, body, location}) => {
      // no-cache on everything, so a worker update check always reaches this server.
      response.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-cache', ...(location ? {Location: location} : {})})
      response.end(body)
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return Object.assign(state, {origin, close: () => new Promise<void>((done) => server.close(() => done()))})
}
