#!/usr/bin/env node
/* Writes dist/client/_headers and dist/client/_redirects (atlas decision 0160, plan Step 3.3).
 * Runs in postbuild, after `astro build`.
 *
 * `_headers` sets the header policy on every response the Workers static-asset plane serves.
 * src/lib/edge/middleware.ts sets the same policy on Worker responses, from the same module
 * (src/lib/edge/security-headers.ts), so the two planes cannot drift.
 *
 * The `_headers` file replaces the one @astrojs/cloudflare writes. The adapter adds an immutable
 * Cache-Control rule for /_astro/*; Pages served those files with the default
 * `public, max-age=0, must-revalidate`, and PR A changes no header (the zone's transform rule
 * still sets the long cache on the production hostname).
 *
 * `_redirects` keeps the Pages 308 for the `.html` and trailing-slash forms of each page
 * (scripts/lib/redirects.mjs). tests/build/static-plane-rules.test.ts checks both files. */
import {readdirSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {renderHeadersFile} from '../src/lib/edge/security-headers.ts'
import {clientDir} from './lib/build-paths.mjs'
import {renderRedirectsFile} from './lib/redirects.mjs'

const root = clientDir()
const htmlFiles = readdirSync(root, {recursive: true, withFileTypes: true}).filter((entry) => entry.isFile() && entry.name.endsWith('.html')).map((entry) =>
  path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/')
)

for (const [name, content] of [['_headers', renderHeadersFile()], ['_redirects', renderRedirectsFile(htmlFiles)]]) {
  const outPath = path.join(root, name)
  writeFileSync(outPath, content)
  console.log(`[generate-static-plane-rules] wrote ${path.relative(process.cwd(), outPath)}`)
}
