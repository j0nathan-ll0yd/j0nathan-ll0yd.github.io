#!/usr/bin/env node
/* Builds the dashboard composer (atlas decision 0160, PR B; owner decision 2026-10-16, option 1):
 * src/lib/composed/compose.ts and the design system's Astro components, compiled with this website's
 * own Astro settings, into one self-contained Node ESM file, dist-composer/composer.mjs.
 *
 * It must be this website's compile: Astro marks scoped styles with a hash of each component's path
 * relative to the build root, so only this build produces the hashes this website's CSS selects. The
 * Worker refuses a fragment with any other hash (src/lib/composed/shell.ts `fitsShell`).
 *
 * Consumers: the backend runner (through the shipped asset), the test data plane
 * (tests/data-plane/server.ts) and the parity oracle (tests/oracle/).
 *
 * With `--ship` (postbuild) it also copies the composer into the built static assets at
 * `/_ssr/composer-<build>.mjs`, where the backend runner fetches it (atlas decision 0160, owner decision
 * 2026-10-16: the live site supplies the composer), and writes the value-free pages the Worker serves
 * while the focus value hides or cannot be read (src/lib/composed/paths.ts VALUE_FREE_PATH). Neither
 * holds an export value. */
import {createRequire} from 'node:module'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {getViteConfig} from 'astro/config'
import {MIRRORED_BOOK_COVERS_DEFINE, mirroredBookCovers} from '../src/lib/book-cover-mirror.ts'
import {VALUE_FREE_PATH} from '../src/lib/composed/paths.ts'
import {buildId, composerPath} from './lib/build-id.mjs'
import {clientDir} from './lib/build-paths.mjs'
import {leakedNames, secretValues} from './lib/env-secrets.mjs'
import {forbidFixtures} from './vite-forbid-fixtures.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const COMPOSER_OUT_DIR = path.join(ROOT, 'dist-composer')

// The composer is PUBLIC. Astro's env plugin inlines the value of any private variable whose name
// appears in a module's source (scripts/lib/env-secrets.mjs), so the build sees no environment but
// this allowlist, and no .env file (envDir is an empty directory). The build id is read first.
const BUILD = buildId()
const COVERS = mirroredBookCovers()
const originalSecrets = secretValues({...process.env})
const KEEP = new Set(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'NODE_ENV'])
// The kept values are checked too: none may reach the public bundle (review M2).
// NODE_ENV is a mode word (`production`) the bundle holds anyway; the machine-specific ones may not.
const keptValues = ['PATH', 'TMPDIR', 'TEMP', 'TMP'].map((name) => process.env[name]).filter((value) => typeof value === 'string' && value.length >= 8)
for (const name of Object.keys(process.env)) {
  if (!KEEP.has(name)) {
    delete process.env[name]
  }
}
const EMPTY_ENV_DIR = mkdtempSync(path.join(tmpdir(), 'composer-env-'))

// vite is astro's own dependency, not the site's: resolve it through astro.
const astroPackageJson = createRequire(import.meta.url).resolve('astro/package.json')
const astroRequire = createRequire(astroPackageJson)
const {build} = await import(pathToFileURL(astroRequire.resolve('vite')).href)

// Astro 7.3's core runtime imports `#astro-internal/ambient-manifest`, and in every Vite server
// environment astro's serialized-manifest plugin resolves it to `virtual:astro:manifest`, which imports
// every on-demand route of this site (the Worker's routes, `cloudflare:workers` among them). The
// composer only uses the Container API, which never reads the ambient manifest, so it takes the
// plain-Node module astro's own `imports` field maps that specifier to, and the public bundle holds no
// route code. `tests/build/worker-output.test.ts` fails if the bundle imports any module.
const AMBIENT_MANIFEST = '#astro-internal/ambient-manifest'
const ambientManifestStub = (() => {
  const target = JSON.parse(readFileSync(astroPackageJson, 'utf8')).imports?.[AMBIENT_MANIFEST]?.default
  if (typeof target !== 'string') {
    throw new Error(`astro no longer maps ${AMBIENT_MANIFEST} in its imports field; update this resolver`)
  }
  return path.join(path.dirname(astroPackageJson), target)
})()
const plainNodeAmbientManifest = {
  name: 'composer-plain-node-ambient-manifest',
  enforce: 'pre',
  resolveId(id) {
    return id === AMBIENT_MANIFEST ? ambientManifestStub : null
  }
}

// The same compile settings as astro.config.mjs for markup: compressHTML true.
const base = await getViteConfig({}, {configFile: false, root: new URL('..', import.meta.url), compressHTML: true, vite: {envDir: EMPTY_ENV_DIR}})({
  mode: 'production',
  command: 'build'
})
await build({
  ...base,
  configFile: false,
  publicDir: false,
  logLevel: 'warn',
  // The same build id as the Worker and version.json (scripts/lib/build-id.mjs): every artifact this
  // composer makes names it, and the Worker serves only an artifact of its own build.
  define: {[MIRRORED_BOOK_COVERS_DEFINE]: JSON.stringify(COVERS), __SSR_BUILD_ID__: JSON.stringify(BUILD)},
  // The composer is a public asset: no module may resolve to the test fixtures (atlas 0160 Step 6.7).
  plugins: [plainNodeAmbientManifest, ...(base.plugins ?? []), forbidFixtures()],
  ssr: {noExternal: true, target: 'node'},
  build: {
    ssr: path.join(ROOT, 'src/lib/composed/compose.ts'),
    outDir: COMPOSER_OUT_DIR,
    emptyOutDir: true,
    minify: true,
    rollupOptions: {output: {format: 'esm', entryFileNames: 'composer.mjs', codeSplitting: false}}
  }
})
// Astro passes each component's absolute source path to `$$createComponent` as its module id. The
// composer is a public asset, so this machine's paths become `/site/...`: the ids only label
// components (the scope hashes are already compiled in), and the parity oracle runs on this file.
const bundle = path.join(COMPOSER_OUT_DIR, 'composer.mjs')
const neutral = readFileSync(bundle, 'utf8').replaceAll(ROOT, '/site/')
for (const leak of [ROOT, homedir()]) {
  if (neutral.includes(leak)) {
    throw new Error(`the composer bundle still names a local path (${leak})`)
  }
}
const leaked = leakedNames(neutral, originalSecrets)
if (leaked.length > 0 || keptValues.some((value) => neutral.includes(value))) {
  throw new Error(`the composer bundle holds an environment value (${leaked.join(', ') || 'a kept variable'})`)
}
// Astro's env object is `Object.assign({BASE_URL...}, {<private vars>})`; the private part must be empty.
const envObjects = [...neutral.matchAll(/Object\.assign\(\{BASE_URL:[^}]*\},(\{[^}]*\})\)/g)]
if (envObjects.length === 0) {
  // A guard that matches nothing is blind: Astro changed the form, so re-derive this check.
  throw new Error('the composer bundle has no Astro env object to check; update this guard')
}
if (envObjects.some((match) => match[1] !== '{}')) {
  throw new Error('the composer bundle inlines a private environment variable')
}
writeFileSync(bundle, neutral)
console.log(`[build-composer] wrote ${path.relative(ROOT, bundle)}`)

if (process.argv.includes('--ship')) {
  // Ships this build's composer as a public static asset (served with no Worker CPU), and the
  // value-free pages it composes. scripts/write-version.mjs names the composer and its sha256.
  const composer = path.join(clientDir(ROOT), composerPath(BUILD))
  mkdirSync(path.dirname(composer), {recursive: true})
  copyFileSync(path.join(COMPOSER_OUT_DIR, 'composer.mjs'), composer)
  console.log(`[build-composer] shipped ${path.relative(ROOT, composer)}`)
  const {composeValueFree} = await import(pathToFileURL(path.join(COMPOSER_OUT_DIR, 'composer.mjs')).href)
  const out = path.join(clientDir(ROOT), VALUE_FREE_PATH)
  writeFileSync(out, JSON.stringify(await composeValueFree()))
  console.log(`[build-composer] wrote ${path.relative(ROOT, out)}`)
}
