#!/usr/bin/env node
/* Postbuild gate (atlas decision 0160, PR B): fails when the value of any secret-looking variable,
 * from the process or from this repo's .env files, occurs in any built file under dist/, as written
 * or JSON-escaped. Astro inlines a private variable's value into a server module whenever its name
 * appears in that module's source (scripts/lib/env-secrets.mjs), so a token could reach the Worker
 * bundle or a public asset without any code asking for it. It reports variable names only, never
 * values, and it fails when it read no file, because a blind gate must stay loud. */
import {createRequire} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {scanBuiltFiles, secretValues} from './lib/env-secrets.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// vite is astro's own dependency, not the site's: resolve it through astro.
const astroRequire = createRequire(createRequire(import.meta.url).resolve('astro/package.json'))
const {loadEnv} = await import(pathToFileURL(astroRequire.resolve('vite')).href)
// The same view of the environment Astro's env plugin has: the process plus every .env file.
const secrets = secretValues({...loadEnv('production', ROOT, ''), ...process.env})
const {checked, leaks} = scanBuiltFiles(path.join(ROOT, 'dist'), secrets)
if (checked === 0) {
  console.error('[check-no-env-secrets] FAIL: no built file to check under dist/')
  process.exit(1)
}
if (leaks.length > 0) {
  console.error(`[check-no-env-secrets] FAIL: the value of a secret-looking variable is in a built file:\n  ${leaks.join('\n  ')}`)
  process.exit(1)
}
console.log(`[check-no-env-secrets] OK: ${checked} built files hold none of ${secrets.length} secret-looking values`)
