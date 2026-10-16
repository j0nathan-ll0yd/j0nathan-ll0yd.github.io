import {getViteConfig} from 'astro/config'
import {MIRRORED_BOOK_COVERS_DEFINE, mirroredBookCovers} from './src/lib/book-cover-mirror'

// The edge-injection parity oracle (atlas decision 0160, PR B, owner decision 2026-10-16). Astro renders
// the design-system widgets here, in Node, through the Container API; the Worker never runs this path.
export default getViteConfig({
  define: {[MIRRORED_BOOK_COVERS_DEFINE]: JSON.stringify(mirroredBookCovers()), __SSR_BUILD_ID__: JSON.stringify('test')},
  test: {environment: 'node', include: ['tests/oracle/**/*.test.ts'], testTimeout: 60_000}
  // No astro.config.mjs: its Cloudflare adapter brings a Vite plugin that refuses the test environment.
  // The widgets need only Astro's compiler, which this inline config provides.
}, {configFile: false, compressHTML: true})
