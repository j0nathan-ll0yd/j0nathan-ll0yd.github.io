import { defineConfig } from 'astro/config';
import AstroPWA from '@vite-pwa/astro';

export default defineConfig({
  site: 'https://j0nathan-ll0yd.github.io',
  output: 'static',
  integrations: [
    AstroPWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Jonathan Lloyd — Command Center',
        short_name: 'Command Center',
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
        globPatterns: ['**/*.{css,js,html,svg,png,ico,txt,webmanifest}']
      }
    })
  ]
});
