import { defineConfig } from 'astro/config';
import AstroPWA from '@vite-pwa/astro';

const showcaseDevOnly = {
  name: 'showcase-dev-only',
  hooks: {
    'astro:config:setup'({ injectRoute, command }) {
      if (command === 'dev') {
        injectRoute({ pattern: '/showcase', entrypoint: 'src/showcase/index.astro' });
        injectRoute({ pattern: '/showcase/brand-guide', entrypoint: 'src/showcase/brand-guide.astro' });
        injectRoute({ pattern: '/showcase/left-panel', entrypoint: 'src/showcase/left-panel.astro' });
        injectRoute({ pattern: '/showcase/top-bar', entrypoint: 'src/showcase/top-bar.astro' });
        injectRoute({ pattern: '/showcase/body-column', entrypoint: 'src/showcase/body-column.astro' });
        injectRoute({ pattern: '/showcase/mind-column', entrypoint: 'src/showcase/mind-column.astro' });
        injectRoute({ pattern: '/showcase/github-widgets', entrypoint: 'src/showcase/github-widgets.astro' });
      }
    }
  }
};

export default defineConfig({
  site: 'https://j0nathan-ll0yd.github.io',
  output: 'static',
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
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Jonathan Lloyd — Human Datastream',
        short_name: 'Human Datastream',
        description: 'Senior Software Engineer portfolio dashboard',
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
