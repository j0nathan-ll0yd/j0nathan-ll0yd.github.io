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
 * The catch-all Cloudflare Pages Function that handles those beacons lives at:
 *   functions/simple/[[path]].ts  → route prefix /simple
 *
 * If these two values diverge, the SA script silently sends beacons to a path
 * with no handler — total, silent data loss. This script enforces the invariant
 * mechanically at build time.
 *
 * Reads SA_COLLECTION_PATH exported from functions/sa.ts (the single source of
 * truth for the path= query param) and asserts it equals the route directory
 * name derived from functions/simple/[[path]].ts.
 *
 * Wired into package.json prebuild via `audit:sa-path`.
 */
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

var __dirname = path.dirname(fileURLToPath(import.meta.url))
var repoRoot = path.resolve(__dirname, '..')

// 1. Derive the route prefix from the filesystem by discovering the catch-all
// collection Function: functions/<dir>/[[path]].ts → routePrefix = /<dir>.
// Discovered (not hardcoded) so a rename of the route directory is caught.
var functionsDir = path.join(repoRoot, 'functions')
var catchAllDirs = fs.readdirSync(functionsDir, {withFileTypes: true}).filter((d) =>
  d.isDirectory() && fs.existsSync(path.join(functionsDir, d.name, '[[path]].ts'))
).map((d) => d.name)

if (catchAllDirs.length !== 1) {
  console.error(
    '✗ check-sa-proxy-path: expected exactly ONE catch-all collection Function ' +
      'at functions/<dir>/[[path]].ts, found ' +
      catchAllDirs.length +
      ' [' +
      catchAllDirs.join(', ') +
      '].'
  )
  console.error('  This assertion derives the SA collection route from that directory; ' + 'disambiguate before building.')
  process.exit(1)
}
var routePrefix = '/' + catchAllDirs[0]

// 2. Extract SA_COLLECTION_PATH from functions/sa.ts (read as text — no TS import)
var saFunctionPath = path.join(repoRoot, 'functions', 'sa.ts')
if (!fs.existsSync(saFunctionPath)) {
  console.error('✗ check-sa-proxy-path: functions/sa.ts not found.')
  process.exit(1)
}

var saSource = fs.readFileSync(saFunctionPath, 'utf-8')

// Match: export const SA_COLLECTION_PATH = '/simple';
var match = saSource.match(/export\s+const\s+SA_COLLECTION_PATH\s*=\s*['"]([^'"]+)['"]/)
if (!match) {
  console.error('✗ check-sa-proxy-path: SA_COLLECTION_PATH not found in functions/sa.ts.')
  console.error("  Add: export const SA_COLLECTION_PATH = '/simple';")
  process.exit(1)
}
var collectionPath = match[1]

// 3. Also verify the path= query param in the proxy script URL matches.
// Match only inside a quoted string literal (opening quote before the URL, closing
// quote at end) so the comment-line occurrence of the URL is ignored.
var urlMatch = saSource.match(/['"`]https:\/\/simpleanalyticsexternal\.com\/proxy\.js\?[^'"`]*path=([^&'"`\n]+)/)
if (!urlMatch) {
  console.error('✗ check-sa-proxy-path: proxy.js URL with path= param not found in functions/sa.ts.')
  process.exit(1)
}
var queryPath = '/' + urlMatch[1].replace(/^\//, '')

// 4. Assert all three agree
var ok = true

if (collectionPath !== routePrefix) {
  console.error('✗ check-sa-proxy-path: MISMATCH — SA_COLLECTION_PATH (' + collectionPath + ') !== route prefix (' + routePrefix + ').')
  console.error('  SA beacons will be sent to ' + collectionPath + ' but the Function handles ' + routePrefix + '.')
  console.error(
    '  Fix: rename functions/' + collectionPath.replace(/^\//, '') + ' OR update SA_COLLECTION_PATH + the proxy.js path= param in functions/sa.ts.'
  )
  ok = false
}

if (queryPath !== routePrefix) {
  console.error('✗ check-sa-proxy-path: MISMATCH — proxy.js path= param (' + queryPath + ') !== route prefix (' + routePrefix + ').')
  console.error('  The SA script will bake ' + queryPath + ' as the collection path but the Function handles ' + routePrefix + '.')
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
