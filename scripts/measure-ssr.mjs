#!/usr/bin/env node
/* Measures the server render of `/` (atlas decision 0160, PR B; plan Step 6.10).
 *
 * Sends GET / to a Worker Version URL (or any base URL) and records, per request: the status, the
 * time to first byte and the total time (curl, one new connection per request, as Step 0.3 measured
 * the Pages baseline), the `X-SSR-Data` summary and the `cf-ray`. It then prints the D2 numbers:
 * the useful-render rate, TTFB p50/p75/p95/p99 and the budget overruns. CPU time comes from Workers
 * analytics, not from here (`--cpu`).
 *
 * Version URLs sit behind Cloudflare Access (decision 0160, D1). The service token comes from
 * CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET, or from .env.local. It is written to a 0600 header
 * file for curl and never printed or passed on a command line.
 *
 * Usage:
 *   node scripts/measure-ssr.mjs --base <url> [--count 100] [--concurrency 4] [--fault <spec>]
 *        [--gap-ms 0] [--label warm] [--out /tmp/file.jsonl] [--path /] [--header 'Name: value' ...]
 *   node scripts/measure-ssr.mjs --summarize /tmp/a.jsonl [/tmp/b.jsonl ...]
 *
 * `--fault` sends `X-SSR-Fault` (src/lib/data-plane/faults.ts); the preview honors it only because
 * the PR upload sets SSR_FAULT_INJECTION. `--header` adds a request header, once per flag, for the other
 * test seams (`X-SSR-Data-Plane: fixture`, `X-SSR-Clock`). `--gap-ms` spaces requests apart (a
 * cold-isolate series). */
import {spawn} from 'node:child_process'
import {appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {pathToFileURL} from 'node:url'

/** D2 limits (decision 0160): useful renders, TTFB p75 within 300 ms of the Pages baseline, a 3 s ceiling. */
export const D2 = Object.freeze({usefulRate: 0.995, pagesBaselineTtfbP75Ms: 124.8, ttfbAllowanceMs: 300, ceilingMs: 3_000})
/** Summaries that count as a useful render: every live card live, empty or stale. */
const USEFUL = new Set(['live', 'stale'])

function parseArgs(argv) {
  const args = {path: '/', count: 100, concurrency: 4, gapMs: 0, label: 'run', fault: null, headers: [], base: null, out: null, summarize: []}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    if (flag === '--base') {
      args.base = next()
    } else if (flag === '--path') {
      args.path = next()
    } else if (flag === '--count') {
      args.count = Number(next())
    } else if (flag === '--concurrency') {
      args.concurrency = Number(next())
    } else if (flag === '--gap-ms') {
      args.gapMs = Number(next())
    } else if (flag === '--label') {
      args.label = next()
    } else if (flag === '--fault') {
      args.fault = next()
    } else if (flag === '--header') {
      args.headers.push(next())
    } else if (flag === '--out') {
      args.out = next()
    } else if (flag === '--summarize') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args.summarize.push(argv[++i])
      }
    } else {
      throw new Error(`unknown flag ${flag}`)
    }
  }
  return args
}

/** KEY=VALUE pairs of a dotenv file; values are returned, never printed. */
function readDotenv(file) {
  if (!existsSync(file)) {
    return {}
  }
  const out = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match) {
      out[match[1]] = match[2].replace(/^['"]|['"]$/g, '')
    }
  }
  return out
}

function accessHeaders() {
  const dotenv = readDotenv(path.resolve(process.cwd(), '.env.local'))
  const id = process.env.CF_ACCESS_CLIENT_ID || dotenv.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET || dotenv.CF_ACCESS_CLIENT_SECRET
  return id && secret ? [`CF-Access-Client-Id: ${id}`, `CF-Access-Client-Secret: ${secret}`] : []
}

/** One GET through curl: a new connection, timings from curl's own clock. */
function probe(url, headerFile) {
  return new Promise((resolve) => {
    const format = '%{http_code} %{time_starttransfer} %{time_total}'
    const child = spawn('curl', ['-s', '-o', '/dev/null', '-D', '-', '-H', `@${headerFile}`, '--max-time', '20', '-w', `\n__T__ ${format}`, url])
    let stdout = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.on('close', () => {
      const timing = /__T__ (\d+) ([\d.]+) ([\d.]+)/.exec(stdout)
      const header = (name) => new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'im').exec(stdout)?.[1] ?? null
      resolve({
        status: timing ? Number(timing[1]) : 0,
        ttfb_ms: timing ? Math.round(Number(timing[2]) * 10000) / 10 : null,
        total_ms: timing ? Math.round(Number(timing[3]) * 10000) / 10 : null,
        x_ssr_data: header('x-ssr-data'),
        x_site_runtime: header('x-site-runtime'),
        cf_ray: header('cf-ray')
      })
    })
  })
}

export function percentile(sorted, p) {
  if (sorted.length === 0) {
    return null
  }
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

/** The D2 numbers of a set of records. */
export function summarize(records) {
  const total = records.length
  const bySummary = {}
  for (const record of records) {
    bySummary[record.x_ssr_data ?? `status-${record.status}`] = (bySummary[record.x_ssr_data ?? `status-${record.status}`] ?? 0) + 1
  }
  const suppressed = bySummary.suppressed ?? 0
  const judged = total - suppressed
  const useful = records.filter((record) => record.status === 200 && USEFUL.has(record.x_ssr_data)).length
  const ttfb = records.map((record) => record.ttfb_ms).filter((value) => typeof value === 'number').sort((a, b) => a - b)
  const overruns = records.filter((record) => record.x_ssr_data === 'fallback' || (record.total_ms ?? 0) > D2.ceilingMs).length
  const p75 = percentile(ttfb, 75)
  return {
    total,
    bySummary,
    usefulRate: judged > 0 ? useful / judged : null,
    usefulRateExcludes: 'suppressed renders (a correct state during hiding, not a failure)',
    ttfbMs: {p50: percentile(ttfb, 50), p75, p95: percentile(ttfb, 95), p99: percentile(ttfb, 99), max: ttfb.at(-1) ?? null},
    budgetOverruns: overruns,
    errors: records.filter((record) => record.status !== 200).length,
    d2: {
      ttfbP75WithinAllowance: p75 === null ? null : p75 <= D2.pagesBaselineTtfbP75Ms + D2.ttfbAllowanceMs,
      ttfbP75LimitMs: D2.pagesBaselineTtfbP75Ms + D2.ttfbAllowanceMs
    }
  }
}

async function run(args) {
  if (!args.base) {
    throw new Error('--base is required')
  }
  const url = new URL(args.path, args.base).href
  const dir = mkdtempSync(path.join(tmpdir(), 'measure-ssr-'))
  const headerFile = path.join(dir, 'headers')
  const headers = [...accessHeaders(), 'Accept: text/html', ...(args.fault ? [`X-SSR-Fault: ${args.fault}`] : []), ...args.headers]
  writeFileSync(headerFile, headers.join('\n') + '\n', {mode: 0o600})
  const records = []
  let next = 0
  try {
    const worker = async () => {
      while (next < args.count) {
        const index = next++
        const record = {i: index, label: args.label, fault: args.fault, at: new Date().toISOString(), ...(await probe(url, headerFile))}
        records.push(record)
        if (args.out) {
          appendFileSync(args.out, JSON.stringify(record) + '\n')
        }
        if (args.gapMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, args.gapMs))
        }
      }
    }
    await Promise.all(Array.from({length: Math.max(1, args.concurrency)}, worker))
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
  return records
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.summarize.length > 0) {
    const records = args.summarize.flatMap((file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)))
    console.log(JSON.stringify(summarize(records), null, 2))
    return
  }
  const records = await run(args)
  console.log(JSON.stringify({label: args.label, fault: args.fault, ...summarize(records)}, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(`[measure-ssr] ${error.message}`)
    process.exit(1)
  })
}
