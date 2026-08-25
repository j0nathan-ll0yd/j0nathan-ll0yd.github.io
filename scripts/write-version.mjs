#!/usr/bin/env node
/* Emits dist/version.json so the deployed build id is externally inspectable.
 *
 * NOT a client reload path — the service worker lifecycle owns graceful updates
 * (public/js/sw-register.js). This file exists for observability: the post-deploy
 * smoke check fetches it and asserts the live site actually serves the just-built
 * commit, catching a silently-stale or failed deploy that the hydration checks
 * cannot. Served no-store via functions/_middleware.ts.
 *
 * Plan: .omc/plans/graceful-deploy-auto-update-plan.md (Phase 2). */
import {writeFileSync} from 'node:fs'
import path from 'node:path'

const build = process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || 'dev'
const outPath = path.resolve(process.cwd(), 'dist', 'version.json')

writeFileSync(outPath, JSON.stringify({build, builtAt: new Date().toISOString()}) + '\n')
console.log(`[write-version] wrote dist/version.json (build=${build})`)

// A2B SCRATCH: deliberate lint violation (no-unused-vars) -- do not merge
const a2bScratchUnused = 1
