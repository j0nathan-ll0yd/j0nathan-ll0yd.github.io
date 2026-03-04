import { defineConfig } from 'astro/config';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
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
        injectRoute({ pattern: '/showcase/fullscreen-overlays', entrypoint: 'src/showcase/fullscreen-overlays.astro' });
        injectRoute({ pattern: '/showcase/404-pages', entrypoint: 'src/showcase/404-pages.astro' });
      }
    },
    'astro:server:setup'({ server }) {
      server.middlewares.use('/previews', (req, res, next) => {
        const filePath = join(process.cwd(), 'src/showcase/previews', req.url);
        if (existsSync(filePath) && filePath.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html');
          res.end(readFileSync(filePath, 'utf-8'));
        } else {
          next();
        }
      });
    }
  }
};

export default defineConfig({
  site: 'https://jonathanlloyd.me',
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
      filter: (page) => !page.includes('/showcase/'),
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
