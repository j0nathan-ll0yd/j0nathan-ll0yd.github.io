#!/usr/bin/env node
/* Fails a production deploy whose Worker config sets a test-only variable (atlas decision 0160, PR B).
 *
 * DATA_PLANE_BASE points the server render at a fixture data plane (plan Steps 4.1 and 6.2), and
 * SSR_FAULT_INJECTION enables the Step 6.10 fault header. Production must read CloudFront and inject
 * nothing, so `.github/workflows/deploy.yml` runs this check right before `wrangler deploy`. It reads
 * the config `wrangler deploy` reads (dist/server/wrangler.json) and the deploy job's own environment,
 * and also fails when a local secrets file (dist/server/.dev.vars) survived the build.
 *
 * Exit 0: no forbidden variable. Exit 1: one is set; the message names it, never its value. */
import {existsSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {serverDir} from './lib/build-paths.mjs'

/** The Worker variables production must never set. */
export const FORBIDDEN_DEPLOY_VARS = Object.freeze(['DATA_PLANE_BASE', 'SSR_FAULT_INJECTION'])

/** Every forbidden variable the Worker config or the environment sets, by name. */
export function forbiddenVars(config, env = {}) {
  const vars = config && typeof config.vars === 'object' && config.vars !== null ? config.vars : {}
  const found = []
  for (const name of FORBIDDEN_DEPLOY_VARS) {
    if (Object.hasOwn(vars, name)) {
      found.push(`${name} (wrangler.json vars)`)
    }
    if (env[name] !== undefined && env[name] !== '') {
      found.push(`${name} (deploy environment)`)
    }
  }
  return found
}

function main() {
  const dir = serverDir()
  const configPath = path.join(dir, 'wrangler.json')
  if (!existsSync(configPath)) {
    console.error(`[check-deploy-vars] ${path.relative(process.cwd(), configPath)} is missing; build before deploying`)
    process.exit(1)
  }
  const found = forbiddenVars(JSON.parse(readFileSync(configPath, 'utf8')), process.env)
  if (existsSync(path.join(dir, '.dev.vars'))) {
    found.push('dist/server/.dev.vars (local secrets file)')
  }
  if (found.length > 0) {
    console.error(`[check-deploy-vars] production must not set: ${found.join(', ')}`)
    process.exit(1)
  }
  console.log(`[check-deploy-vars] OK: none of ${FORBIDDEN_DEPLOY_VARS.join(', ')} is set`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
}
