#!/usr/bin/env node
/* Postbuild gate (atlas decision 0160, PR B): fails when the value of any secret-looking variable,
 * from the process or from this repo's .env files, occurs in any built file under dist/. Astro inlines
 * a private variable's value into a server module whenever its name appears in that module's source
 * (scripts/lib/env-secrets.mjs), so a token could reach the Worker bundle or a public asset without any
 * code asking for it. It reports variable names only, never values. */
import {readdirSync, readFileSync, statSync} from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {leakedNames, secretValues} from './lib/env-secrets.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
// vite is astro's own dependency, not the site's: resolve it through astro.
const astroRequire = createRequire(createRequire(import.meta.url).resolve('astro/package.json'))
const {loadEnv} = await import(pathToFileURL(astroRequire.resolve('vite')).href)
const DIST = path.join(ROOT, 'dist')
// The same view of the environment Astro's env plugin has: the process plus every .env file.
const secrets = secretValues({...loadEnv('production', ROOT, ''), ...process.env})

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* files(full)
    } else if (/\.(?:m?js|json|html|txt|css|map|xml|md|webmanifest)$/.test(entry) || !entry.includes('.')) {
      yield full
    }
  }
}

const leaks = []
let checked = 0
for (const file of files(DIST)) {
  checked++
  const names = leakedNames(readFileSync(file, 'utf8'), secrets)
  if (names.length > 0) {
    leaks.push(`${path.relative(ROOT, file)}: ${names.join(', ')}`)
  }
}
if (leaks.length > 0) {
  console.error(`[check-no-env-secrets] FAIL: the value of a secret-looking variable is in a built file:\n  ${leaks.join('\n  ')}`)
  process.exit(1)
}
console.log(`[check-no-env-secrets] OK: ${checked} built files hold none of ${secrets.length} secret-looking values`)
