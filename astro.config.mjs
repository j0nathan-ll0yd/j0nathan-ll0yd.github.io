import { defineConfig } from 'astro/config';
import AstroPWA from '@vite-pwa/astro';
import sitemap from '@astrojs/sitemap';
import { CLOUDFRONT_BASE, SITE_URL } from '@lifegames/portal-contract/constants';
import identity from '@lifegames/copy/identity.flat.json';

// Host portion of CLOUDFRONT_BASE, regex-escaped for use in service-worker
// urlPattern RegExps so the CloudFront host is never hardcoded here.
const CF_HOST = new URL(CLOUDFRONT_BASE).host;
const CF_HOST_RE = CF_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'never',
  build: { inlineStylesheets: 'always' },
  vite: {
    build: {
      // Force every bundled JS chunk to emit as an external _astro/*.js file
      // instead of being inlined into the HTML. Required because production CSP
      // (functions/_middleware.ts) does not allow inline scripts — `'self'` only
      // covers the hashed external chunks. See .omc/plans/fix-bio-csp-blocked-inline-script.md.
      assetsInlineLimit: 0,
    },
    server: {
      proxy: {
        '/api/live': {
          target: CLOUDFRONT_BASE,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/live/, ''),
        }
      }
    }
  },
  integrations: [
    sitemap({
      lastmod: new Date()
    }),
    AstroPWA({
      registerType: 'autoUpdate',
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
          { src: '/assets/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{css,js,html,svg,png,ico,txt,webmanifest,woff2}'],
        globIgnores: ['images/books/**', 'images/theatre/**'],
        navigateFallback: null,
        // Immediate activation so fix deploys reach returning visitors on next
        // page load instead of waiting for all tabs to close.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            // Local optimized images — CacheFirst (downloaded at build time from CloudFront)
            urlPattern: /\/images\/(books|theatre)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'local-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 2592000 }
            }
          },
          {
            // CloudFront images fallback — safety net for onerror fallback fetches
            urlPattern: new RegExp(`^https://${CF_HOST_RE}/images/`),
            handler: 'CacheFirst',
            options: {
              cacheName: 'optimized-images-fallback',
              expiration: { maxEntries: 50, maxAgeSeconds: 604800 }
            }
          },
          {
            // CloudFront JSON data — NetworkFirst for guaranteed freshness
            // Poll requests (?_poll=1) bypass the SW entirely via negative lookahead
            urlPattern: new RegExp(`^https://${CF_HOST_RE}/(?!.*[?&]_poll=).*\\.json$`),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'live-data',
              networkTimeoutSeconds: 3,
              fetchOptions: { cache: 'no-store' },
              expiration: { maxAgeSeconds: 300 }
            }
          }
        ]
      }
    })
  ]
});
