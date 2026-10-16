import {fileURLToPath} from 'node:url'
import {defineConfig} from 'astro/config'
import AstroPWA from '@vite-pwa/astro'
import sitemap from '@astrojs/sitemap'
import cloudflare from '@astrojs/cloudflare'
import {CLOUDFRONT_BASE, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import identity from '@j0nathan-ll0yd/copy/identity.flat.json'
import {forbidFixtures} from './scripts/vite-forbid-fixtures.mjs'
import {clientNoProcessBanner} from './scripts/vite-client-no-process-banner.mjs'
import llm from '@j0nathan-ll0yd/copy/llm.flat.json'
import {AGENT_PATHS} from './src/lib/edge/agent-paths.mjs'
import {SITE_PAGE_PATHS} from './src/lib/edge/site-paths.ts'
import {contentLastModified} from './src/lib/content-date.ts'
import {MIRRORED_BOOK_COVERS_DEFINE, mirroredBookCovers} from './src/lib/book-cover-mirror.ts'
import {readFileSync} from 'node:fs'

// Host portion of CLOUDFRONT_BASE, regex-escaped for use in service-worker
// urlPattern RegExps so the CloudFront host is never hardcoded here.
const CF_HOST = new URL(CLOUDFRONT_BASE).host
const CF_HOST_RE = CF_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The static-asset directory. With the Cloudflare adapter Astro writes static files to
// dist/client/ and the Worker to dist/server/. @vite-pwa/astro points the service worker at the
// client directory only for `output: 'server'`; this site is `static` with an adapter, so without
// these two options sw.js and its precache manifest land in dist/server/ and the precache is empty.
const CLIENT_DIR = fileURLToPath(new URL('./dist/client/', import.meta.url))

// The content date of each copy-driven page, from its copy lastModified key.
const COPY_PAGE_LASTMOD = {
  [SITE_PAGE_PATHS.about]: contentLastModified(identity.about.lastModified),
  [SITE_PAGE_PATHS.contact]: contentLastModified(identity.contact.lastModified),
  [AGENT_PATHS.developers]: contentLastModified(llm.developers.lastModified)
}

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  // Cloudflare Workers (atlas decision 0160, PR A). Every page stays prerendered; only the
  // routes in src/lib/edge/routes.ts render on demand. prerenderEnvironment 'node' keeps the
  // prerender in Node, as before (the adapter defaults to workerd). imageService 'compile' keeps
  // build-time image work in Node and adds no Images binding. src/worker.ts wraps the handler.
  adapter: cloudflare({prerenderEnvironment: 'node', imageService: 'compile'}),
  // No sessions: the adapter would otherwise add a KV namespace binding the site never reads.
  session: false,
  // No origin check on the on-demand routes. Pages Functions had none, and browsers send CSP reports
  // and analytics beacons as cross-site-looking POSTs that Astro's check would answer with 403.
  security: {checkOrigin: false},
  trailingSlash: 'never',
  // `file` builds privacy.html, not privacy/index.html, to match trailingSlash: 'never'. Cloudflare
  // serves x.html at /x with a 200 and answers /x.html and /x/ with a redirect to /x. A directory
  // index (x/index.html) is served only at /x/, so /x, the canonical URL, would redirect.
  // tests/build/canonical-urls.test.ts fails if any canonical or sitemap URL needs a redirect.
  build: {format: 'file', inlineStylesheets: 'always'},
  // Astro 7 changed the compressHTML default to 'jsx', which collapses whitespace
  // between inline elements differently and subtly reflows text-heavy widgets (the
  // bio terminal + movement-rings labels shifted 1-3% of pixels vs the committed
  // baselines). Pin to `true` to keep Astro 6's HTML-aware whitespace behavior so
  // the upgrade is visually identical and the CI-parity baselines stay valid.
  compressHTML: true,
  vite: {
    // Build-time constants. The book-cover mirror list lets the server render choose same-origin
    // covers without a filesystem; the build id stamps the server render's log line (decision 0160,
    // PR B, plan Step 4.6).
    define: {
      [MIRRORED_BOOK_COVERS_DEFINE]: JSON.stringify(mirroredBookCovers()),
      __SSR_BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA || 'dev'),
      // The design-system version this build renders with; a composed artifact must name the same.
      __WEB_VERSION__: JSON.stringify(JSON.parse(readFileSync(new URL('./node_modules/@j0nathan-ll0yd/web/package.json', import.meta.url), 'utf8')).version),
      // The commit the preview's fixture data plane reads (src/lib/data-plane/faults.ts FIXTURE_REF).
      __SSR_FIXTURE_REF__: JSON.stringify(process.env.SSR_FIXTURE_REF || 'main')
    },
    // Fails the build when any module resolves to @j0nathan-ll0yd/fixtures, directly or through
    // another module or package (atlas decision 0160, plan Step 6.7). Production pages carry no
    // fixture data; tests serve fixtures by route interception only.
    // clientNoProcessBanner: the adapter's Worker banner must not reach the browser bundle.
    plugins: [forbidFixtures(), clientNoProcessBanner()],
    build: {
      // Force every bundled JS chunk to emit as an external _astro/*.js file
      // instead of being inlined into the HTML. Required because production CSP
      // (src/lib/edge/security-headers.ts) does not allow inline scripts — `'self'` only
      // covers the hashed external chunks. See .omc/plans/fix-bio-csp-blocked-inline-script.md.
      assetsInlineLimit: 0
    },
    server: {proxy: {'/api/live': {target: CLOUDFRONT_BASE, changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/live/, '')}}}
  },
  integrations: [
    sitemap({
      // Enrich the sitemap with per-page SEO signals. It lists only indexable pages: the home
      // page, /about, /contact, and /developers. The filter drops /404, the noindex /500 error page, the noindex /offline
      // service-worker fallback, and the noindex /privacy (a sitemap entry for a noindex page
      // is a contradiction search engines report); crawlers and the trust-anchor check still
      // reach /privacy by path and through every page's rel="privacy-policy" link.
      // lastmod means "content last changed", and it is emitted only where an authored date
      // exists. The three static text pages carry their copy lastModified key (serialize()
      // below). / carries NONE: it is live data with no verifiable content date, CI checks out
      // with depth 1 so git history gives a wrong date, and a build-date lastmod is the
      // anti-pattern docs/wiki/Metadata-Files-Spec.md names (website #360).
      // tests/build/sitemap.test.ts asserts both halves.
      // Matched on the exact pathname.
      filter: (page) => !['/404', '/500', '/offline', SITE_PAGE_PATHS.privacy].includes(new URL(page).pathname),
      changefreq: 'weekly',
      priority: 0.7,
      serialize(item) {
        const path = new URL(item.url).pathname
        if (path === '/') {
          item.changefreq = 'daily'
          item.priority = 1.0
        } else if (path in COPY_PAGE_LASTMOD) {
          // Copy-driven pages: they change only when a @j0nathan-ll0yd/copy release does.
          item.changefreq = 'monthly'
          item.priority = 0.5
          item.lastmod = COPY_PAGE_LASTMOD[path]
        }
        return item
      }
    }),
    AstroPWA({
      outDir: CLIENT_DIR,
      registerType: 'autoUpdate',
      // The graceful update controller is hand-rolled in public/js/sw-register.js
      // (single registration + deferred state-preserving reload). Suppress the
      // plugin's auto-injected registerSW.js so there is exactly one registration.
      injectRegister: false,
      manifest: {
        name: identity.site.fullName,
        short_name: identity.site.name,
        description: identity.site.pwaDescription,
        start_url: '/',
        scope: '/',
        theme_color: '#06060f',
        background_color: '#06060f',
        display: 'standalone',
        icons: [
          {src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png'},
          {src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable'}
        ]
      },
      workbox: {
        globDirectory: CLIENT_DIR,
        // HTML documents are NOT precached, except the data-free /offline page
        // (atlas decision 0160, PR 0b). A precached document answers a navigation
        // from the precache before any runtime route runs, so a precached `/`
        // replayed the dashboard shell, fixture values and all, offline and even
        // online until the next worker update. Navigations now go to the network
        // (the NetworkOnly route below) and fall back to /offline only when the
        // network fails. scripts/check-sw-precache.mjs enforces both rules.
        // @vite-pwa/astro rewrites the offline.html entry to the URL `offline`, so the
        // worker precaches /offline, which the host answers with a 200 and no redirect.
        globPatterns: ['**/*.{css,js,svg,png,ico,txt,webmanifest,woff2}', 'offline.html'],
        globIgnores: ['images/books/**', 'images/theatre/**'],
        navigateFallback: null,
        // Immediate activation so fix deploys reach returning visitors on next
        // page load instead of waiting for all tabs to close. REQUIRED here, not
        // redundant with registerType:'autoUpdate': injectRegister:false suppresses
        // the plugin's register script, so nothing posts SKIP_WAITING — without these
        // the generated sw.js emits no clientsClaim() and no unconditional
        // skipWaiting(), so a new SW never claims the open tab → no controllerchange
        // → public/js/sw-register.js's graceful reload never fires. (Verified via build.)
        skipWaiting: true,
        clientsClaim: true,
        // Deletes the retired `live-data` cache on activate, so a returning
        // visitor loses any gated JSON the old NetworkFirst route stored.
        // scripts/check-sw-precache.mjs fails the build if this import is lost.
        importScripts: ['/js/sw-purge.js'],
        // No route here may match CloudFront JSON or focus.json (atlas decision
        // 0160, PR 0b). A cached focus signal or gated export replayed after a
        // timeout or offline can show data while the owner hides it. The client
        // already fetches them with `cache: 'no-store'` (src/lib/runtime/api.ts),
        // so with no route they go straight to the network.
        // scripts/check-sw-precache.mjs enforces this.
        runtimeCaching: [
          {
            // Every navigation goes to the network. On a network failure the
            // precached data-free /offline page answers instead; nothing else
            // is ever served for a navigation from a cache. precacheFallback
            // adds Workbox's PrecacheFallbackPlugin, so no catch handler exists.
            urlPattern: ({request}) => request.mode === 'navigate',
            handler: 'NetworkOnly',
            options: {precacheFallback: {fallbackURL: '/offline'}}
          },
          {
            // Local optimized images — CacheFirst (downloaded at build time from CloudFront).
            // Classified by origin and pathname ONLY. A regex tests the whole URL, so the old
            // /\/images\/(books|theatre)\// matched /feed.json?preview=/images/books/ and cached a
            // gated feed for 30 days. The cache is renamed because the old "local-images" cache can
            // hold such entries; public/js/sw-purge.js and sw-register.js delete it.
            // The pathname is anchored on ONE file-name segment: an origin that decodes %2F and
            // resolves `..` served /images/books/..%2F..%2Ffeed.json as the gated feed, and an
            // open-ended prefix cached it. Every mirror file name matches this shape.
            urlPattern: ({url, sameOrigin}) => sameOrigin && /^\/images\/(books|theatre)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {cacheName: 'local-images-v2', expiration: {maxEntries: 200, maxAgeSeconds: 2592000}}
          },
          {
            // CloudFront images fallback — safety net for onerror fallback fetches. Anchored on
            // the origin, the image root and one file-name segment, end to end: no query string,
            // encoded slash or dot segment can change the match.
            urlPattern: new RegExp(`^https://${CF_HOST_RE}/images/(books|theatre)/[A-Za-z0-9][A-Za-z0-9._-]*$`),
            handler: 'CacheFirst',
            options: {cacheName: 'optimized-images-fallback', expiration: {maxEntries: 50, maxAgeSeconds: 604800}}
          }
        ]
      }
    })
  ]
})
