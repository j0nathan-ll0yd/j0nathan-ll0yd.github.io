#!/usr/bin/env node
/* Pre-cutover check: Cloudflare Access guards ONLY the Worker's previews (atlas decision 0160 D1;
 * plan Step 3.7 precondition).
 *
 * Gate G3 attached Access to the human-datastream Worker. Access destinations of type
 * `preview_worker` cover the Version URLs alone; type `worker` covers every request to the Worker,
 * its production hostname included. Measured 2026-10-14: the application carried a `worker`
 * destination. Cut over with that in place and every visitor of jonathanlloyd.me meets an Access
 * login. So the cutover runbook runs this check first, and again on the production hostname as
 * soon as the Worker answers it.
 *
 * Pass:
 *   1. API: at least one Access application destination names this Worker (so the Version URLs
 *      stay guarded), and every one that does is `preview_worker`;
 *   2. with --url: an anonymous GET answers 200 with X-Site-Runtime: workers.
 *
 * Usage (read-only; the token needs Access: Apps and Policies Read and Workers Scripts Read):
 *   CLOUDFLARE_ACCOUNT_ID=... CF_READ_TOKEN=... node scripts/check-worker-access-scope.mjs \
 *     [--worker human-datastream] [--url https://jonathanlloyd.me/]
 * Exit 0 on pass, 1 on fail, 2 on usage error. */
import {parseArgs} from 'node:util'
import {SITE_RUNTIME, SITE_RUNTIME_HEADER} from '../src/lib/edge/security-headers.ts'

const API = 'https://api.cloudflare.com/client/v4'
const PREVIEWS_ONLY = 'preview_worker'

/**
 * Judges the Access applications against one Worker tag.
 * @param {Array<{name: string, destinations?: Array<{type: string, worker_id?: string}>}>} apps
 * @param {string} workerTag
 * @returns {string[]} failures; empty when Access guards the previews only
 */
export function judgeAccessScope(apps, workerTag) {
  const failures = []
  let named = 0
  for (const app of apps) {
    for (const destination of app.destinations ?? []) {
      if (destination.worker_id !== workerTag) {
        continue
      }
      named += 1
      if (destination.type !== PREVIEWS_ONLY) {
        failures.push(
          `Access application "${app.name}" has a "${destination.type}" destination on this Worker: it gates every request, production included. It must be "${PREVIEWS_ONLY}" (Previews only).`
        )
      }
    }
  }
  if (named === 0) {
    failures.push(`no Access application names this Worker: its Version URLs would be public`)
  }
  return failures
}

/** Judges one anonymous response from the Worker's production hostname. */
export function judgeProductionResponse(status, runtime) {
  if (status !== 200) {
    return [`an anonymous GET answered ${status}, not 200: Access (or something else) gates production`]
  }
  if (runtime !== SITE_RUNTIME) {
    return [`the 200 carries ${SITE_RUNTIME_HEADER}: ${JSON.stringify(runtime)}: the Worker did not answer`]
  }
  return []
}

async function api(path, token) {
  const response = await fetch(`${API}${path}`, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15_000)})
  const body = await response.json()
  if (!body.success) {
    throw new Error(`${path}: ${JSON.stringify(body.errors)}`)
  }
  return body.result
}

async function main() {
  const {values} = parseArgs({options: {worker: {type: 'string', default: 'human-datastream'}, url: {type: 'string'}}})
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CF_READ_TOKEN
  if (!account || !token) {
    console.error('check-worker-access-scope: set CLOUDFLARE_ACCOUNT_ID and CF_READ_TOKEN')
    process.exit(2)
  }
  const scripts = await api(`/accounts/${account}/workers/scripts`, token)
  const worker = scripts.find((script) => script.id === values.worker)
  if (!worker) {
    console.error(`check-worker-access-scope: no Worker named ${values.worker}`)
    process.exit(1)
  }
  const failures = judgeAccessScope(await api(`/accounts/${account}/access/apps`, token), worker.tag)
  if (values.url) {
    const response = await fetch(values.url, {redirect: 'manual', signal: AbortSignal.timeout(15_000)})
    failures.push(...judgeProductionResponse(response.status, response.headers.get(SITE_RUNTIME_HEADER)))
  }
  console.log(failures.length === 0 ? `PASS Access guards only the previews of ${values.worker}` : `FAIL ${values.worker}`)
  for (const failure of failures) {
    console.log(`  ${failure}`)
  }
  process.exit(failures.length === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
