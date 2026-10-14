#!/usr/bin/env node
/* Read-only capability probe for the CI deploy token (atlas decision 0160, Step 3.7).
 *
 * After the cutover, deploy.yml runs `wrangler deploy` with the production route declared. That needs
 * Workers Scripts (the upload), Zone read (wrangler resolves `zone_name` to a zone id), Workers Routes
 * (wrangler lists the zone's routes, then replaces the Worker's route set) and Cache Purge (the purge
 * step). This probe makes one GET per capability and prints ONLY the endpoint and its HTTP status, so
 * the token can be confirmed before the merge. A GET proves read access, not edit access: Workers
 * Routes Edit and Cache Purge show only on the first real deploy.
 *
 * Usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_ZONE_ID=... node scripts/check-deploy-token.mjs
 * Report only: exit 0 always; a non-200 prints a ::warning under GitHub Actions. */
import {appendFileSync} from 'node:fs'

const API = 'https://api.cloudflare.com/client/v4'

/** The probes: [label, path]. Paths carry only ids, never a secret. */
export function probes(account, zone) {
  return [
    ['Zone read (zone by id)', `/zones/${zone}`],
    ['Zone read (zone by name, as wrangler resolves zone_name)', '/zones?name=jonathanlloyd.me'],
    ['Workers Routes read (zone routes)', `/zones/${zone}/workers/routes`],
    ['Workers Scripts read (human-datastream settings)', `/accounts/${account}/workers/scripts/human-datastream/settings`],
    ['Account Settings read (account)', `/accounts/${account}`]
  ]
}

async function main() {
  const {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_ZONE_ID: zone} = process.env
  if (!token || !account || !zone) {
    console.log('::warning::check-deploy-token: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_ZONE_ID is not set; nothing probed')
    return
  }
  const lines = []
  for (const [label, path] of probes(account, zone)) {
    let status
    try {
      const response = await fetch(`${API}${path}`, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(15_000)})
      status = String(response.status)
      await response.arrayBuffer()
    } catch (error) {
      status = `transport error (${error instanceof Error ? (error.cause?.code ?? error.message) : String(error)})`
    }
    lines.push(`${status === '200' ? 'OK  ' : 'MISS'} ${status} ${label}`)
    if (status !== '200') {
      console.log(`::warning title=Deploy token capability::${label}: HTTP ${status}`)
    }
  }
  console.log(lines.join('\n'))
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Deploy token capabilities (read-only probe)\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
