import { defineConfig } from 'astro/config';
import AstroPWA from '@vite-pwa/astro';
import sitemap from '@astrojs/sitemap';

const showcaseDevOnly = {
  name: 'showcase-dev-only',
  hooks: {
    'astro:config:setup'({ injectRoute, command }) {
      if (command === 'dev') {
        injectRoute({ pattern: '/showcase', entrypoint: 'src/showcase/index.astro' });
        injectRoute({ pattern: '/showcase/brand-guide', entrypoint: 'src/showcase/brand-guide.astro' });
        injectRoute({ pattern: '/showcase/identity-system', entrypoint: 'src/showcase/identity-system.astro' });
        injectRoute({ pattern: '/showcase/health-wellness', entrypoint: 'src/showcase/health-wellness.astro' });
        injectRoute({ pattern: '/showcase/contributions-commits', entrypoint: 'src/showcase/contributions-commits.astro' });
        injectRoute({ pattern: '/showcase/repositories-languages', entrypoint: 'src/showcase/repositories-languages.astro' });
        injectRoute({ pattern: '/showcase/activity-feeds', entrypoint: 'src/showcase/activity-feeds.astro' });
        injectRoute({ pattern: '/showcase/reading-books', entrypoint: 'src/showcase/reading-books.astro' });
        injectRoute({ pattern: '/showcase/responsive-preview', entrypoint: 'src/showcase/responsive-preview.astro' });
        injectRoute({ pattern: '/showcase/og-images', entrypoint: 'src/showcase/og-images.astro' });
        injectRoute({ pattern: '/showcase/location-widgets', entrypoint: 'src/showcase/location-widgets.astro' });
      }
    }
  }
};

export default defineConfig({
  site: 'https://j0nathan-ll0yd.github.io',
  output: 'static',
  trailingSlash: 'never',
  vite: {
    server: {
      proxy: {
        '/api/live': {
          target: 'https://d2nfgi9u0n3jr6.cloudfront.net',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/live/, ''),
        }
      }
    }
  },
  integrations: [
    showcaseDevOnly,
    sitemap({
      filter: (page) => !page.includes('/showcase/')
    }),
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Jonathan Lloyd — Human Datastream',
        short_name: 'Human Datastream',
        description: 'Engineering Director portfolio dashboard',
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
        globPatterns: ['**/*.{css,js,html,svg,png,ico,txt,webmanifest}'],
        runtimeCaching: [{
          urlPattern: /^https:\/\/d2nfgi9u0n3jr6\.cloudfront\.net\/.*/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'live-data',
            networkTimeoutSeconds: 5,
            expiration: { maxAgeSeconds: 300 }
          }
        }]
      }
    })
  ]
});
