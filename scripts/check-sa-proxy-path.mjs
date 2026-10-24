#!/usr/bin/env node
/* check-sa-proxy-path.mjs -- Blocking build assertion (Issue #83 / B10).
 *
 * The Simple Analytics proxy script is fetched from:
 *   https://simpleanalyticsexternal.com/proxy.js?hostname=jonathanlloyd.me&path=/simple
 *
 * That `path=` value is baked into the served script and dictates which URL
 * path the SA client sends collection beacons to:
 *   https://jonathanlloyd.me/simple/simple.gif  (pageview)
 *   https://jonathanlloyd.me/simple/append      (sendBeacon)
 *
 * The catch-all on-demand route that handles those beacons lives at:
 *   src/pages/simple/[...path].ts  → route prefix /simple
 * (functions/simple/[[path]].ts on Cloudflare Pages, before atlas decision 0160 PR A).
 *
 * If these two values diverge, the SA script silently sends beacons to a path
 * with no handler — total, silent data loss. This script enforces the invariant
 * mechanically at build time.
 *
 * Reads SA_COLLECTION_PATH exported from src/pages/sa.ts (the single source of
 * truth for the path= query param) and asserts it equals the route directory
 * name derived from src/pages/simple/[...path].ts.
 *
 * Wired into package.json prebuild via `audit:sa-path`.
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

var __dirname = path.dirname(fileURLToPath(import.meta.url))
var repoRoot = path.resolve(__dirname, '..')

// 1. Derive the route prefix from the filesystem by discovering the catch-all
// collection route: src/pages/<dir>/[...path].ts → routePrefix = /<dir>.
// Discovered (not hardcoded) so a rename of the route directory is caught. Other
// catch-all routes exist (src/pages/api/[...path].ts, the developer API's not-found
// problem), so the collection route is the catch-all that forwards to the Simple
// Analytics collector.
var SA_COLLECTOR_HOST = 'queue.simpleanalyticscdn.com'
var pagesDir = path.join(repoRoot, 'src', 'pages')
var catchAllDirs = fs.readdirSync(pagesDir, {withFileTypes: true}).filter((d) => {
  var file = path.join(pagesDir, d.name, '[...path].ts')
  return d.isDirectory() && fs.existsSync(file) && fs.readFileSync(file, 'utf-8').includes(SA_COLLECTOR_HOST)
}).map((d) => d.name)

if (catchAllDirs.length !== 1) {
  console.error(
    '✗ check-sa-proxy-path: expected exactly ONE catch-all collection route ' +
      'at src/pages/<dir>/[...path].ts forwarding to ' +
      SA_COLLECTOR_HOST +
      ', found ' +
      catchAllDirs.length +
      ' [' +
      catchAllDirs.join(', ') +
      '].'
  )
  console.error('  This assertion derives the SA collection route from that directory; ' + 'disambiguate before building.')
  process.exit(1)
}
var routePrefix = '/' + catchAllDirs[0]

// 2. Extract SA_COLLECTION_PATH from src/pages/sa.ts (read as text — no TS import)
var saFunctionPath = path.join(repoRoot, 'src', 'pages', 'sa.ts')
if (!fs.existsSync(saFunctionPath)) {
  console.error('✗ check-sa-proxy-path: src/pages/sa.ts not found.')
  process.exit(1)
}

var saSource = fs.readFileSync(saFunctionPath, 'utf-8')

// Match: export const SA_COLLECTION_PATH = '/simple';
var match = saSource.match(/export\s+const\s+SA_COLLECTION_PATH\s*=\s*['"]([^'"]+)['"]/)
if (!match) {
  console.error('✗ check-sa-proxy-path: SA_COLLECTION_PATH not found in src/pages/sa.ts.')
  console.error("  Add: export const SA_COLLECTION_PATH = '/simple';")
  process.exit(1)
}
var collectionPath = match[1]

// 3. Also verify the path= query param in the proxy script URL matches.
// Match only inside a quoted string literal (opening quote before the URL, closing
// quote at end) so the comment-line occurrence of the URL is ignored.
var urlMatch = saSource.match(/['"`]https:\/\/simpleanalyticsexternal\.com\/proxy\.js\?[^'"`]*path=([^&'"`\n]+)/)
if (!urlMatch) {
  console.error('✗ check-sa-proxy-path: proxy.js URL with path= param not found in src/pages/sa.ts.')
  process.exit(1)
}
var queryPath = '/' + urlMatch[1].replace(/^\//, '')

// 4. Assert all three agree
var ok = true

if (collectionPath !== routePrefix) {
  console.error('✗ check-sa-proxy-path: MISMATCH — SA_COLLECTION_PATH (' + collectionPath + ') !== route prefix (' + routePrefix + ').')
  console.error('  SA beacons will be sent to ' + collectionPath + ' but the route handles ' + routePrefix + '.')
  console.error(
    '  Fix: rename src/pages/' + collectionPath.replace(/^\//, '') + ' OR update SA_COLLECTION_PATH + the proxy.js path= param in src/pages/sa.ts.'
  )
  ok = false
}

if (queryPath !== routePrefix) {
  console.error('✗ check-sa-proxy-path: MISMATCH — proxy.js path= param (' + queryPath + ') !== route prefix (' + routePrefix + ').')
  console.error('  The SA script will bake ' + queryPath + ' as the collection path but the route handles ' + routePrefix + '.')
  ok = false
}

if (collectionPath !== queryPath) {
  console.error('✗ check-sa-proxy-path: MISMATCH — SA_COLLECTION_PATH (' + collectionPath + ') !== proxy.js path= param (' + queryPath + ').')
  console.error('  Keep SA_COLLECTION_PATH and the proxy.js URL path= param in sync.')
  ok = false
}

if (!ok) {
  process.exit(1)
}

console.log('check-sa-proxy-path: path invariant verified ✓')
console.log('  SA_COLLECTION_PATH = ' + collectionPath)
console.log('  proxy.js path=     = ' + queryPath)
console.log('  route prefix       = ' + routePrefix)
