// The one source for the site's response-header policy (atlas decision 0160, plan Step 3.3).
//
// Two planes serve this site's responses on Workers, and each needs the same policy:
// - The static-asset plane serves a file without running the Worker. Cloudflare applies
//   `_headers` there, and only there. scripts/generate-static-plane-rules.mjs writes `_headers` from
//   `renderHeadersFile()` below.
// - The Worker (src/worker.ts) runs for every path in wrangler.jsonc `run_worker_first`
//   and for every path that matches no file. src/lib/edge/middleware.ts sets the same
//   headers on those responses, because `_headers` never applies to a Worker response.
//
// This module imports only a package, never a relative path, so the Node build script can
// import it with type stripping alone.

import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'

// WebSocket CSP source is the ORIGIN only (no /live path); CLOUDFRONT_BASE is
// already an origin. Sourcing both from the contract keeps the CSP in sync with
// the live addressing without hardcoded literals.
const WEBSOCKET_ORIGIN = new URL(WEBSOCKET_URL).origin

// Exported so audits/__tests__/csp-golden.test.ts can diff it against
// audits/fixtures/golden/csp.txt. audits/checks/b7-check-headers.mjs only catches that
// drift against the LIVE site, which is after a deploy; the two must move in lockstep
// here. (The check has lived at that path since the atlas decision 0111 phase 2b audit
// migration; this comment still called it check-headers.mjs until 0142 phase 7. The
// lockstep instruction it carries was and remains correct -- only the filename was stale.)
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `img-src 'self' data: https://*.basemaps.cartocdn.com ${CLOUDFRONT_BASE}`,
  `connect-src 'self' ${CLOUDFRONT_BASE} ${WEBSOCKET_ORIGIN}`,
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
  // Violation reporting: report-to (Reporting API, modern) + report-uri (legacy fallback).
  // The named endpoint matches the Reporting-Endpoints header set below.
  'report-uri /api/csp-report; report-to csp-endpoint'
].join('; ') + ';'

// CSP violation reports are collected at /api/csp-report (src/pages/api/csp-report.ts).
// The Reporting-Endpoints header names the endpoint; the CSP report-to directive references
// that name. report-uri is retained as a fallback for older browsers (Firefox <130, Safari <17).
export const REPORTING_ENDPOINTS = 'csp-endpoint="https://jonathanlloyd.me/api/csp-report"'

// Trusted Types telemetry, REPORT-ONLY (non-enforcing). Every script is first-party
// (script-src 'self') with no user-input XSS surface, so this does NOT enforce
// require-trusted-types-for -- it drains DOM injection-sink violations to the same
// /api/csp-report collector to scope a possible future enforcement. Review the reports,
// then remove this or promote the directive into the enforced CSP. Expect roughly one
// report per innerHTML sink while it runs.
export const CSP_REPORT_ONLY = "require-trusted-types-for 'script'; report-uri /api/csp-report; report-to csp-endpoint"

// IETF AI Preferences Working Group drafts attach-05/vocab-08 define
// Content-Usage as an HTTP Structured Field Dictionary. Keep this out of
// robots.txt until consumers such as Lighthouse recognize that extension.
// vocab-08 adds `ai-use`; atlas decision 0174 E2 deferred stating it.
export const CONTENT_USAGE = 'train-ai=n, search=y'

export const PERMISSIONS_POLICY =
  'accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), compute-pressure=(), display-capture=(), document-domain=(), encrypted-media=(), fullscreen=(), gamepad=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-create=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), speaker-selection=(), usb=(), web-share=(), xr-spatial-tracking=()'

/**
 * The platform marker (atlas decision 0160, plan Step 3.1). The middleware sends it as
 * X-Site-Runtime on every Worker response, and scripts/write-version.mjs writes it to
 * /version.json, so the cutover and its rollback can tell which platform answered. It is the
 * one intended difference in the Step 3.6 parity comparison.
 */
export const SITE_RUNTIME = 'workers'
export const SITE_RUNTIME_HEADER = 'X-Site-Runtime'

/** The CSP trio. The site sets it on every response that ran code on Pages, and on no other. */
export const CSP_HEADERS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['Content-Security-Policy', CSP],
  ['Reporting-Endpoints', REPORTING_ENDPOINTS],
  ['Content-Security-Policy-Report-Only', CSP_REPORT_ONLY]
])

/** The security headers every response carries, on both planes. */
export const BASE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Content-Usage', CONTENT_USAGE],
  // HSTS: 2-year max-age + subdomains. Preload intentionally omitted -- owner-gated process.
  ['Strict-Transport-Security', 'max-age=63072000; includeSubDomains'],
  ['X-Frame-Options', 'DENY'],
  // COOP: same-origin-allow-popups permits OAuth/payment popups while isolating the browsing context.
  // COEP/CORP omitted -- would break the cross-origin Carto tile resources.
  ['Cross-Origin-Opener-Policy', 'same-origin-allow-popups'],
  ['Permissions-Policy', PERMISSIONS_POLICY]
])

/**
 * The paths that never ran code on Pages: `public/_routes.json` excluded them from Functions, so
 * their responses carried the `_headers` policy alone, without the CSP trio. They keep exactly that.
 */
export const CODE_FREE_PREFIXES = Object.freeze(['/_astro/', '/fonts/', '/css/', '/vendor/', '/assets/'])

/**
 * Pages answered every static-asset response, its 404 page and its 405 included, with
 * `Access-Control-Allow-Origin: *`, and no response that a Function built. Workers static assets
 * add no such header, so the site states it.
 */
export const ASSET_PLANE_HEADERS: ReadonlyArray<readonly [string, string]> = Object.freeze([['Access-Control-Allow-Origin', '*']])

/** Per-path asset headers, carried over unchanged from the Pages `public/_headers` file. */
export const ASSET_PATH_HEADERS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = Object.freeze({
  '/robots.txt': [['Cache-Control', 'public, max-age=3600, s-maxage=86400']],
  // Pages served .js files as application/javascript; Workers static assets serve them as
  // text/javascript; charset=utf-8. A `_headers` Content-Type replaces the default.
  '/*.js': [['Content-Type', 'application/javascript']],
  // Pages served every text type with charset=utf-8; the deployed Workers asset server drops it
  // (measured on the PR A Version URL, 2026-10-14). HTML pages are extensionless URLs, so
  // renderHeadersFile adds one rule per built page.
  '/*.css': [['Content-Type', 'text/css; charset=utf-8']],
  '/*.txt': [['Content-Type', 'text/plain; charset=utf-8']],
  '/*.md': [['Content-Type', 'text/markdown; charset=utf-8']]
})

/** The text media types Pages served with charset=utf-8 (see ASSET_PATH_HEADERS). */
const UTF8_TEXT_TYPES = new Set(['text/html', 'text/plain', 'text/css', 'text/markdown'])

/**
 * A text Content-Type with `charset=utf-8` added when it names none, as Pages served it. For the
 * responses the Worker takes from the ASSETS binding (`/` and the 404 page). Other types pass as is.
 */
export function withUtf8Charset(contentType: string | null): string | null {
  if (contentType === null) {
    return null
  }
  const [type = '', ...params] = contentType.split(';').map((part) => part.trim())
  if (!UTF8_TEXT_TYPES.has(type.toLowerCase()) || params.some((param) => param.toLowerCase().startsWith('charset='))) {
    return contentType
  }
  return `${type}; charset=utf-8`
}

/** True when a path never ran code on Pages (see CODE_FREE_PREFIXES). */
export function isCodeFreePath(pathname: string): boolean {
  return CODE_FREE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

/**
 * The `_headers` file for the static-asset plane. Each `/*` header applies to every asset; the
 * CSP trio is detached again (`! Name`) under each code-free prefix, so those assets keep the
 * Pages header set exactly.
 */
export function renderHeadersFile(pagePaths: readonly string[] = []): string {
  const blocks: string[] = []
  const all = [...ASSET_PLANE_HEADERS, ...BASE_SECURITY_HEADERS, ...CSP_HEADERS]
  blocks.push(['/*', ...all.map(([name, value]) => `  ${name}: ${value}`)].join('\n'))
  for (const prefix of CODE_FREE_PREFIXES) {
    blocks.push([`${prefix}*`, ...CSP_HEADERS.map(([name]) => `  ! ${name}`)].join('\n'))
  }
  for (const [path, headers] of Object.entries(ASSET_PATH_HEADERS)) {
    blocks.push([path, ...headers.map(([name, value]) => `  ${name}: ${value}`)].join('\n'))
  }
  // One rule per built page (its canonical, extensionless URL): the charset rule above for HTML.
  for (const path of pagePaths) {
    blocks.push([path, '  Content-Type: text/html; charset=utf-8'].join('\n'))
  }
  return blocks.join('\n\n') + '\n'
}
