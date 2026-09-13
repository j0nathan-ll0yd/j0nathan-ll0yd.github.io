// Verifies the service worker's Workbox precache manifest is populated.
//
// Catches the class of bug where the PWA build succeeds but ships a
// service worker with an EMPTY (or near-empty) precache list. Such a SW
// registers cleanly, passes every other gate (manifest emitted, CSP intact,
// runtimeCaching present because it is copied from config), and silently
// breaks offline caching. The failure mode is invisible without this check.
//
// This became a real risk in the Astro 7 upgrade: `@vite-pwa/astro` drives
// `vite-plugin-pwa`/Workbox's `generateSW`, which populates the precache list
// from the Vite bundle graph via a Rollup-style `generateBundle` hook. Astro 7
// bundles Vite 8 (Rolldown); if that hook ever fails to fire, the injected
// `precacheAndRoute([...])` array empties out while the build still "succeeds".
//
// Shape-agnostic by design: Astro 6 (terser) emitted quoted object keys
// (`{"url":"...","revision":"..."}`); Astro 7 (Rolldown/oxc-minify) emits
// UNQUOTED keys (`{url:"...",revision:...}`). Both are matched. Note that
// content-hashed `_astro/*.js` entries legitimately carry `revision:null`
// (the hash IS the version) — so we do NOT require a non-null revision on
// every entry; we require the manifest to be POPULATED and to contain the
// app shell, and we derive the expected floor from the actual built assets.
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join, resolve} from 'node:path'

const distDir = resolve(process.cwd(), 'dist')
const swPath = join(distDir, 'sw.js')

// Workbox globPatterns / globIgnores from astro.config.mjs. Kept in sync there;
// if the PWA glob config changes, update this list too.
const PRECACHE_EXT_RE = /\.(css|js|html|svg|png|ico|txt|webmanifest|woff2)$/
const GLOB_IGNORE_RE = /\/images\/(books|theatre)\//
// sw.js and the workbox-<hash>.js runtime are never self-precached.
const SW_RUNTIME_RE = /\/(sw|workbox-[^/]+)\.js$/

// App-shell URLs that MUST be precached for the offline experience to work.
const REQUIRED_URLS = ['/', 'manifest.webmanifest']

let sw
try {
  sw = readFileSync(swPath, 'utf-8')
} catch (err) {
  console.error('[check-sw-precache] Could not read', swPath, ':', err.message)
  console.error('Likely cause: the PWA integration did not emit a service worker.')
  process.exit(1)
}

if (sw.includes('self.__WB_MANIFEST')) {
  console.error('[check-sw-precache] FAIL: unreplaced `self.__WB_MANIFEST` token in sw.js.')
  console.error('Workbox did not inject the precache manifest — the build hook did not fire.')
  process.exit(1)
}

const arrayMatch = sw.match(/precacheAndRoute\(\[(.*?)\]\s*,/s)
if (!arrayMatch) {
  console.error('[check-sw-precache] FAIL: no `precacheAndRoute([...])` array found in sw.js.')
  process.exit(1)
}
const arrayBody = arrayMatch[1]

// Extract each entry's url, tolerating quoted or unquoted keys.
const urlRe = /["']?url["']?\s*:\s*["']([^"']+)["']/g
const urls = [...arrayBody.matchAll(urlRe)].map((m) => m[1])
const entryCount = urls.length

// Derive the expected floor from the actual built assets (1:1 with globPatterns).
function walk(dir) {
  let out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out = out.concat(walk(p))
    } else {
      out.push(p)
    }
  }
  return out
}
const globbed = walk(distDir).filter((f) => PRECACHE_EXT_RE.test(f) && !GLOB_IGNORE_RE.test(f) && !SW_RUNTIME_RE.test(f))
const floor = globbed.length
// Allow modest slack (route/file URL transforms, dedup) but fail on an
// empty or gutted manifest. Baseline (Astro 6 and Astro 7) is a clean 38/38.
const minEntries = Math.max(1, Math.floor(floor * 0.8))

const problems = []
if (entryCount < minEntries) {
  problems.push(
    `precache has ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} but expected >= ${minEntries} ` +
      `(built assets: ${floor}). An empty/gutted precache silently breaks offline.`
  )
}
const urlSet = new Set(urls)
for (const required of REQUIRED_URLS) {
  if (!urlSet.has(required)) {
    problems.push(`missing app-shell URL in precache: "${required}"`)
  }
}

if (!sw.includes('self.skipWaiting()')) {
  problems.push('generated service worker does not call self.skipWaiting()')
}
if (!/\bclientsClaim\(\)/.test(sw)) {
  problems.push('generated service worker does not call Workbox clientsClaim()')
}

function runtimeRoute(cacheName) {
  const cacheMatch = new RegExp(`["']?cacheName["']?\\s*:\\s*["']${cacheName}["']`).exec(sw)
  if (!cacheMatch) {
    return null
  }
  const start = sw.lastIndexOf('registerRoute(', cacheMatch.index)
  const next = sw.indexOf('registerRoute(', cacheMatch.index + cacheMatch[0].length)
  return start >= 0 ? sw.slice(start, next >= 0 ? next : sw.length) : null
}

const localImagesRoute = runtimeRoute('local-images')
if (!localImagesRoute) {
  problems.push('missing local-images runtime route')
} else {
  if (!localImagesRoute.includes('/\\/images\\/(books|theatre)\\//')) {
    problems.push('local-images runtime route no longer matches /images/(books|theatre)/')
  }
  if (!localImagesRoute.includes('CacheFirst')) {
    problems.push('local-images runtime route is not CacheFirst')
  }
  if (!/["']?maxEntries["']?\s*:\s*200/.test(localImagesRoute) || !/["']?maxAgeSeconds["']?\s*:\s*(2592000|2592e3)/.test(localImagesRoute)) {
    problems.push('local-images runtime route lost maxEntries=200 or maxAgeSeconds=2592000')
  }
}

const cloudfrontImagesRoute = runtimeRoute('optimized-images-fallback')
if (!cloudfrontImagesRoute) {
  problems.push('missing optimized-images-fallback runtime route')
} else {
  if (!cloudfrontImagesRoute.includes('cloudfront\\.net\\/images\\/')) {
    problems.push('optimized-images-fallback route no longer targets the CloudFront /images/ path')
  }
  if (!cloudfrontImagesRoute.includes('CacheFirst')) {
    problems.push('optimized-images-fallback runtime route is not CacheFirst')
  }
  if (!/["']?maxEntries["']?\s*:\s*50/.test(cloudfrontImagesRoute) || !/["']?maxAgeSeconds["']?\s*:\s*604800/.test(cloudfrontImagesRoute)) {
    problems.push('optimized-images-fallback route lost maxEntries=50 or maxAgeSeconds=604800')
  }
}

if (problems.length > 0) {
  console.error('[check-sw-precache] FAIL:')
  for (const p of problems) {
    console.error('  -', p)
  }
  console.error('')
  console.error('Likely cause: Workbox generateSW did not glob dist assets — check that')
  console.error('@vite-pwa/astro + vite-plugin-pwa ran and that Vite/Rolldown emitted the bundle')
  console.error('graph before the PWA build hook. See astro.config.mjs workbox.globPatterns.')
  process.exit(1)
}

console.log('[check-sw-precache] OK —', entryCount, 'precache entries (floor', floor + ');', 'app shell, activation, and image runtime routes present.')
