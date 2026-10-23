// Where the server reads the data plane (atlas decision 0160, plan Step 4.1).
//
// Production reads the CloudFront data plane, `CLOUDFRONT_BASE`. The Worker variable
// `DATA_PLANE_BASE` points a local or test run at a fixture data plane instead (plan Step 6.2). Two
// locks keep it off production, as for the fault headers (./faults.ts):
// 1. The production deploy job fails when the built config sets it (`scripts/check-deploy-vars.mjs`).
// 2. Even when it is set (a Worker secret, which that guard cannot see), only a request to a
//    `*.workers.dev` Version URL or a loopback host reads it. The admission rules trust
//    `x-amz-cf-id`, which any server can send, so a wrong origin must never reach jonathanlloyd.me.
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'

/** The Worker variable that overrides the data-plane origin. Never set in production. */
export const DATA_PLANE_BASE_VAR = 'DATA_PLANE_BASE'

/**
 * The data-plane origin, without a trailing slash. An unset or empty value is CloudFront. A value
 * that is not an absolute http(s) URL is a configuration error and throws, so a typo can never
 * silently send reads somewhere else.
 */
export function dataPlaneBase(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return CLOUDFRONT_BASE
  }
  if (typeof value !== 'string') {
    throw new TypeError(`${DATA_PLANE_BASE_VAR} must be a string`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${DATA_PLANE_BASE_VAR} is not a URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError(`${DATA_PLANE_BASE_VAR} must be an http(s) URL`)
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new TypeError(`${DATA_PLANE_BASE_VAR} must be a bare origin and path`)
  }
  return url.href.replace(/\/+$/, '')
}

/**
 * The data-plane origin for one request: `DATA_PLANE_BASE` on a preview or loopback host, else
 * CloudFront whatever the variable says.
 */
export function requestDataPlaneBase(request: Request, value: unknown, hostAllowed: (hostname: string) => boolean): string {
  // Unset in production: answer without parsing the request URL.
  if (value === undefined || value === null || value === '') {
    return CLOUDFRONT_BASE
  }
  return hostAllowed(new URL(request.url).hostname) ? dataPlaneBase(value) : CLOUDFRONT_BASE
}
