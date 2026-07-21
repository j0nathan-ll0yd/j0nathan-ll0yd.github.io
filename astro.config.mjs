import {defineConfig} from 'astro/config'
import AstroPWA from '@vite-pwa/astro'
import sitemap from '@astrojs/sitemap'
import {CLOUDFRONT_BASE, SITE_URL} from '@lifegames/portal-contract/constants'
import identity from '@lifegames/copy/identity.flat.json'

// Host portion of CLOUDFRONT_BASE, regex-escaped for use in service-worker
// urlPattern RegExps so the CloudFront host is never hardcoded here.
const CF_HOST = new URL(CLOUDFRONT_BASE).host
const CF_HOST_RE = CF_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'never',
  // Astro 7 changed the compressHTML default to 'jsx', which collapses whitespace
  // between inline elements differently and subtly reflows text-heavy widgets (the
  // bio terminal + movement-rings labels shifted 1-3% of pixels vs the committed
  // baselines). Pin to `true` to keep Astro 6's HTML-aware whitespace behavior so
  // the upgrade is visually identical and the CI-parity baselines stay valid.
  compressHTML: true,
  build: {inlineStylesheets: 'always'},
  vite: {
    define: {
      // Expose the build-time fixture-variation selector to source. Astro/Vite
      // only forwards VITE_-prefixed env to import.meta.env by default; the
      // visual suite sets FIXTURE_VARIATION on the build process to pick a named
      // @lifegames/fixtures post-adapter variation (default 'baseline').
      'import.meta.env.FIXTURE_VARIATION': JSON.stringify(process.env.FIXTURE_VARIATION ?? 'baseline')
    },
    build: {
      // Force every bundled JS chunk to emit as an external _astro/*.js file
      // instead of being inlined into the HTML. Required because production CSP
      // (functions/_middleware.ts) does not allow inline scripts — `'self'` only
      // covers the hashed external chunks. See .omc/plans/fix-bio-csp-blocked-inline-script.md.
      assetsInlineLimit: 0
    },
    server: {proxy: {'/api/live': {target: CLOUDFRONT_BASE, changeOrigin: true, rewrite: (path) => path.replace(/^\/api\/live/, '')}}}
  },
  integrations: [
    sitemap({
      // Enrich the sitemap with per-page SEO signals. The built surface is small
      // (home + privacy); 404 is excluded by Astro automatically, the filter is a
      // guard so a future non-canonical route can never leak in. lastmod is the
      // build time: content is data-driven and can change on every deploy, so a
      // per-build timestamp is honest and avoids a bespoke per-page mtime pipeline.
      filter: (page) => !page.includes('/404'),
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      serialize(item) {
        const path = new URL(item.url).pathname.replace(/\/$/, '') || '/'
        if (path === '/') {
          item.changefreq = 'daily'
          item.priority = 1.0
        } else if (path === '/privacy') {
          item.changefreq = 'monthly'
          item.priority = 0.3
        }
        return item
      }
    }),
    AstroPWA({
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
        globPatterns: ['**/*.{css,js,html,svg,png,ico,txt,webmanifest,woff2}'],
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
        runtimeCaching: [
          {
            // Local optimized images — CacheFirst (downloaded at build time from CloudFront)
            urlPattern: /\/images\/(books|theatre)\//,
            handler: 'CacheFirst',
            options: {cacheName: 'local-images', expiration: {maxEntries: 200, maxAgeSeconds: 2592000}}
          },
          {
            // CloudFront images fallback — safety net for onerror fallback fetches
            urlPattern: new RegExp(`^https://${CF_HOST_RE}/images/`),
            handler: 'CacheFirst',
            options: {cacheName: 'optimized-images-fallback', expiration: {maxEntries: 50, maxAgeSeconds: 604800}}
          },
          {
            // CloudFront JSON data — NetworkFirst for guaranteed freshness
            // Poll requests (?_poll=1) bypass the SW entirely via negative lookahead
            urlPattern: new RegExp(`^https://${CF_HOST_RE}/(?!.*[?&]_poll=).*\\.json$`),
            handler: 'NetworkFirst',
            options: {cacheName: 'live-data', networkTimeoutSeconds: 3, fetchOptions: {cache: 'no-store'}, expiration: {maxAgeSeconds: 300}}
          }
        ]
      }
    })
  ]
})
