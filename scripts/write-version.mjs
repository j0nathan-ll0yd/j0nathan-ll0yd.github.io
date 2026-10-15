#!/usr/bin/env node
/* Emits dist/version.json so the deployed build id is externally inspectable.
 *
 * NOT a client reload path — the service worker lifecycle owns graceful updates
 * (public/js/sw-register.js). This file exists for observability: the post-deploy
 * smoke check fetches it and asserts the live site actually serves the just-built
 * commit, catching a silently-stale or failed deploy that the hydration checks
 * cannot. Served no-store via src/lib/edge/middleware.ts.
 *
 * Plan: .omc/plans/graceful-deploy-auto-update-plan.md (Phase 2). */
import {writeFileSync} from 'node:fs'
import path from 'node:path'
import {SITE_RUNTIME} from '../src/lib/edge/security-headers.ts'
import {clientDir} from './lib/build-paths.mjs'

const build = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || 'dev'
const outPath = path.join(clientDir(), 'version.json')

// runtime: the platform marker (atlas decision 0160, plan Step 3.1). It tells a Workers build from a
// Pages one during the cutover and its rollback; src/lib/edge/middleware.ts sends the same value
// as X-Site-Runtime.
writeFileSync(outPath, JSON.stringify({build, builtAt: new Date().toISOString(), runtime: SITE_RUNTIME}) + '\n')
console.log(`[write-version] wrote dist/version.json (build=${build})`)
