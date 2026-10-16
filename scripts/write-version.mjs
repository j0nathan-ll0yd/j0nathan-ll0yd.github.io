#!/usr/bin/env node
/* Emits dist/client/version.json so the deployed build id is externally inspectable, and names the
 * build's dashboard composer for the backend runner (atlas decision 0160, PR B).
 *
 * NOT a client reload path — the service worker lifecycle owns graceful updates
 * (public/js/sw-register.js). This file exists for observability: the post-deploy
 * smoke check fetches it and asserts the live site actually serves the just-built
 * commit, catching a silently-stale or failed deploy that the hydration checks
 * cannot. Served no-store via src/lib/edge/middleware.ts.
 *
 * Plan: .omc/plans/graceful-deploy-auto-update-plan.md (Phase 2). */
import {createHash} from 'node:crypto'
import {readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {SITE_RUNTIME} from '../src/lib/edge/security-headers.ts'
import {buildId, COMPOSER_CONTRACT, composerPath} from './lib/build-id.mjs'
import {clientDir} from './lib/build-paths.mjs'

const build = buildId()
const outPath = path.join(clientDir(), 'version.json')

// runtime: the platform marker (atlas decision 0160, plan Step 3.1). It tells a Workers build from a
// Pages one during the cutover and its rollback; src/lib/edge/middleware.ts sends the same value
// as X-Site-Runtime.
// composer: the dashboard composer this build ships (atlas decision 0160, PR B). The backend runner
// reads this file, fetches the composer at `path`, checks its sha256 before it imports it, and
// stamps the artifact with `build`; the Worker serves only an artifact of its own build.
const composer = composerPath(build)
const composerBytes = readFileSync(path.join(clientDir(), composer))
const sha256 = createHash('sha256').update(composerBytes).digest('hex')
writeFileSync(outPath,
  JSON.stringify({build, builtAt: new Date().toISOString(), runtime: SITE_RUNTIME, composer: {path: composer, sha256, contract: COMPOSER_CONTRACT}}) + '\n')
console.log(`[write-version] wrote dist/version.json (build=${build})`)
