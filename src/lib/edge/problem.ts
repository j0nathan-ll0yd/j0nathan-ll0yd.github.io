// RFC 9457 problem details for the developer API facade (src/lib/edge/api-v1.ts). Every 4xx and 5xx
// under /api answers one of the API_PROBLEMS types (src/lib/edge/agent-catalog.mjs): the `type` URI
// names a fragment of /developers, `title` and `detail` are static copy, and variable data travels in
// extension members (RFC 9457 section 3.2), never in `detail`.

import {API_PROBLEMS} from './agent-catalog.mjs'

/** The problem media type (RFC 9457 section 3), with the charset every text answer on this site carries. */
export const PROBLEM_MEDIA_TYPE = 'application/problem+json; charset=utf-8'

export type ProblemSlug = 'not-found' | 'method-not-allowed' | 'rate-limited' | 'focus-suppressed' | 'upstream-unavailable'

export interface ProblemType {
  readonly slug: ProblemSlug
  readonly status: number
  readonly title: string
  readonly detail: string
  readonly anchor: string
  readonly type: string
}

const PROBLEM_BY_SLUG: ReadonlyMap<string, ProblemType> = new Map((API_PROBLEMS as readonly ProblemType[]).map((problem) => [problem.slug, problem]))

/** The catalog entry for one slug. Throws on a slug the catalog lacks, so a typo fails a test, not a client. */
export function problemType(slug: ProblemSlug): ProblemType {
  const problem = PROBLEM_BY_SLUG.get(slug)
  if (!problem) {
    throw new Error(`no API problem type "${slug}"`)
  }
  return problem
}

/** The standard members RFC 9457 section 3.1 defines. Extension members never overwrite them. */
const STANDARD_MEMBERS = new Set(['type', 'title', 'status', 'detail', 'instance'])

/** The problem object: the standard members, then the extension members. */
export function problemBody(slug: ProblemSlug, instance: string, extensions: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const problem = problemType(slug)
  const body: Record<string, unknown> = {type: problem.type, title: problem.title, status: problem.status, detail: problem.detail, instance}
  for (const [name, value] of Object.entries(extensions)) {
    if (STANDARD_MEMBERS.has(name)) {
      throw new Error(`problem extension "${name}" would overwrite a standard member`)
    }
    body[name] = value
  }
  return body
}

export interface ProblemOptions {
  /** The request path, reported as `instance`. */
  instance: string
  /** The request method: a HEAD answer carries the headers and no body. */
  method: string
  extensions?: Readonly<Record<string, unknown>>
  /** Extra response headers (Allow, Retry-After, the RateLimit fields, CORS). */
  headers?: HeadersInit
}

/**
 * A problem response. No-store at the browser, the generic CDN and Cloudflare layers, like every
 * response of the gated proxy (src/lib/edge/proxy.ts LLM_OUTPUT_CACHE_POLICY): a problem can state a
 * suppression, which must never outlive the focus state it reports.
 */
export function problemResponse(slug: ProblemSlug, {instance, method, extensions, headers}: ProblemOptions): Response {
  const problem = problemType(slug)
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Content-Type', PROBLEM_MEDIA_TYPE)
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('CDN-Cache-Control', 'no-store')
  responseHeaders.set('Cloudflare-CDN-Cache-Control', 'no-store')
  const body = method === 'HEAD' ? null : JSON.stringify(problemBody(slug, instance, extensions))
  return new Response(body, {status: problem.status, headers: responseHeaders})
}
