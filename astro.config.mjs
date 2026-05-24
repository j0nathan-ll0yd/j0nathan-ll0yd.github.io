import { defineConfig } from 'astro/config';
import AstroPWA from '@vite-pwa/astro';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://jonathanlloyd.me',
  output: 'static',
  trailingSlash: 'never',
  build: { inlineStylesheets: 'always' },
  vite: {
    server: {
      proxy: {
        '/api/live': {
          target: 'https://d1pfm520aduift.cloudfront.net',
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
        name: 'Jonathan Lloyd — Human Datastream',
        short_name: 'Human Datastream',
        description: 'Living data dashboard — tracking body and mind. Jack into his human datastream.',
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
        navigateFallbackDenylist: [/\.xml$/],
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
            urlPattern: /^https:\/\/d1pfm520aduift\.cloudfront\.net\/images\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'optimized-images-fallback',
              expiration: { maxEntries: 50, maxAgeSeconds: 604800 }
            }
          },
          {
            // CloudFront JSON data — NetworkFirst for guaranteed freshness
            // Poll requests (?_poll=1) bypass the SW entirely via negative lookahead
            urlPattern: /^https:\/\/d1pfm520aduift\.cloudfront\.net\/(?!.*[?&]_poll=).*\.json$/,
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
