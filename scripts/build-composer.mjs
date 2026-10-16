#!/usr/bin/env node
/* Builds the dashboard composer (atlas decision 0160, PR B; owner decision 2026-10-16, option 1):
 * src/lib/composed/compose.ts and the design system's Astro components, compiled with this website's
 * own Astro settings, into one self-contained Node ESM file, dist-composer/composer.mjs.
 *
 * It must be this website's compile: Astro marks scoped styles with a hash of each component's path
 * relative to the build root, so only this build produces the hashes this website's CSS selects. The
 * Worker refuses a fragment with any other hash (src/lib/composed/shell.ts `scopesMatch`).
 *
 * Consumers: the test data plane (tests/data-plane/server.ts) and, later, the backend composer. */
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {getViteConfig} from 'astro/config'
import {MIRRORED_BOOK_COVERS_DEFINE, mirroredBookCovers} from '../src/lib/book-cover-mirror.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const COMPOSER_OUT_DIR = path.join(ROOT, 'dist-composer')

// vite is astro's own dependency, not the site's: resolve it through astro.
const astroRequire = createRequire(createRequire(import.meta.url).resolve('astro/package.json'))
const {build} = await import(pathToFileURL(astroRequire.resolve('vite')).href)

// The same compile settings as astro.config.mjs for markup: compressHTML true.
const base = await getViteConfig({}, {configFile: false, root: new URL('..', import.meta.url), compressHTML: true})({mode: 'production', command: 'build'})
await build({
  ...base,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  define: {[MIRRORED_BOOK_COVERS_DEFINE]: JSON.stringify(mirroredBookCovers()), __SSR_BUILD_ID__: '"composer"'},
  ssr: {noExternal: true, target: 'node'},
  build: {
    ssr: path.join(ROOT, 'src/lib/composed/compose.ts'),
    outDir: COMPOSER_OUT_DIR,
    emptyOutDir: true,
    minify: true,
    rollupOptions: {output: {format: 'esm', entryFileNames: 'composer.mjs', codeSplitting: false}}
  }
})
console.log(`[build-composer] wrote ${path.relative(ROOT, path.join(COMPOSER_OUT_DIR, 'composer.mjs'))}`)
