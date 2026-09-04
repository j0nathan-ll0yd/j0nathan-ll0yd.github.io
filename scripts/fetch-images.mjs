#!/usr/bin/env node
/**
 * Audits or updates the committed first-party image mirror.
 *
 *   node scripts/fetch-images.mjs
 *   node scripts/fetch-images.mjs --check-only
 *
 * Check mode requires both manifests, HEAD-verifies every advertised object,
 * validates existing local files, and computes drift in both directions.
 * Stale local files are reported for reviewed pruning and are never deleted.
 */

import {access, mkdir, readdir, stat, writeFile} from 'node:fs/promises'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {probeSuppression, suppressionBody, suppressionDisposition} from '../audits/lib/suppression.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(scriptDir, '..', 'public')
const REPORT_FILE = join(scriptDir, '..', 'image-audit-report.txt')
const MISSING_FILE = join(scriptDir, '..', 'missing-images.txt')
const CONCURRENCY = 5
const IMAGE_ROOTS = ['books', 'theatre']

class SuppressedManifestError extends Error {}

async function fetchJson(endpoint, fetchImpl) {
  const url = `${CLOUDFRONT_BASE}/${endpoint}`
  const response = await fetchImpl(url, {cache: 'no-store'})
  if (response.ok) {
    return response.json()
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    // Non-JSON failures are reported by status below.
  }
  if (suppressionBody(body)) {
    throw new SuppressedManifestError(body.reason)
  }
  throw new Error(`HTTP ${response.status} fetching ${endpoint}`)
}

export function extractImageUrls(booksData, theatreData) {
  const urls = []

  for (const book of booksData?.books || []) {
    for (const field of ['mainImage', 'mainImageAvif', 'mainImageThumb', 'mainImageThumbAvif', 'mainImageCard', 'mainImageCardAvif']) {
      if (book[field]?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(book[field])
      }
    }
  }

  for (const review of theatreData?.reviews || []) {
    for (const field of ['imageUrl', 'imageUrlAvif', 'imageUrlCard', 'imageUrlCardAvif']) {
      if (review[field]?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(review[field])
      }
    }
  }

  return [...new Set(urls)].sort()
}

export function imageRelativePath(url) {
  const parsed = new URL(url)
  if (parsed.origin !== new URL(CLOUDFRONT_BASE).origin || !IMAGE_ROOTS.some((root) => parsed.pathname.startsWith(`/images/${root}/`))) {
    throw new Error(`Image URL is outside the managed mirror: ${url}`)
  }
  return parsed.pathname.replace(/^\//, '')
}

function localPathFor(url, publicDir) {
  const path = resolve(publicDir, imageRelativePath(url))
  const root = resolve(publicDir, 'images') + sep
  if (!path.startsWith(root)) {
    throw new Error(`Image URL escapes public/images: ${url}`)
  }
  return path
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function walkFiles(dir) {
  if (!(await fileExists(dir))) {
    return []
  }
  const entries = await readdir(dir, {withFileTypes: true})
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

export async function listLocalImages(publicDir = PUBLIC_DIR) {
  const files = []
  for (const root of IMAGE_ROOTS) {
    files.push(...await walkFiles(join(publicDir, 'images', root)))
  }
  return files.map((path) => relative(publicDir, path).split(sep).join('/')).sort()
}

export function compareMirror(urls, localImages) {
  const manifest = new Set(urls.map(imageRelativePath))
  const local = new Set(localImages)
  return {missingLocal: [...manifest].filter((path) => !local.has(path)).sort(), staleLocal: [...local].filter((path) => !manifest.has(path)).sort()}
}

export async function verifyRemoteImage(url, fetchImpl = fetch) {
  let response
  try {
    response = await fetchImpl(url, {method: 'HEAD', redirect: 'follow', cache: 'no-store'})
  } catch (error) {
    return {ok: false, reason: `HEAD failed: ${error instanceof Error ? error.message : String(error)}`}
  }
  if (!response.ok) {
    return {ok: false, reason: `HEAD returned HTTP ${response.status}`}
  }
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('image/')) {
    return {ok: false, reason: `content-type is ${contentType || '(missing)'}`}
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return {ok: false, reason: `content-length is ${response.headers.get('content-length') || '(missing)'}`}
  }
  return {ok: true, contentType, contentLength}
}

async function verifyLocalImage(url, publicDir) {
  const path = localPathFor(url, publicDir)
  try {
    const metadata = await stat(path)
    return metadata.isFile() && metadata.size > 0 ? {ok: true} : {ok: false, reason: 'local file is empty or not regular'}
  } catch (error) {
    return {ok: false, reason: error?.code === 'ENOENT' ? 'local file is missing' : `local stat failed: ${error.message}`}
  }
}

async function downloadImage(url, publicDir, fetchImpl) {
  const localPath = localPathFor(url, publicDir)
  if (await fileExists(localPath)) {
    return {status: 'existing', url}
  }

  const response = await fetchImpl(url, {cache: 'no-store'})
  if (!response.ok) {
    return {status: 'failed', url, reason: `GET returned HTTP ${response.status}`}
  }
  const contentType = response.headers.get('content-type') || ''
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!contentType.toLowerCase().startsWith('image/') || buffer.length === 0) {
    return {status: 'failed', url, reason: `invalid image response (${contentType || 'no content-type'}, ${buffer.length} bytes)`}
  }

  await mkdir(dirname(localPath), {recursive: true})
  await writeFile(localPath, buffer)
  return {status: 'downloaded', url}
}

async function runWithConcurrency(items, fn, limit = CONCURRENCY) {
  const results = []
  let index = 0

  async function worker() {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current])
    }
  }

  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker))
  return results
}

function renderReport({manifestErrors = [], missingLocal = [], staleLocal = [], remoteFailures = [], localFailures = []}) {
  const section = (title, values) => [title, ...(values.length > 0 ? values.map((value) => `  ${value}`) : ['  (none)'])]
  return [
    ...section('Manifest errors:', manifestErrors),
    ...section('Manifest minus local (download required):', missingLocal),
    ...section('Local minus manifest (review before pruning; never auto-deleted):', staleLocal),
    ...section('Upstream object verification failures:', remoteFailures),
    ...section('Local file verification failures:', localFailures),
    ''
  ].join('\n')
}

async function writeReports(report, missingUrls, reportFile, missingFile) {
  await writeFile(reportFile, report)
  await writeFile(missingFile, missingUrls.length > 0 ? missingUrls.join('\n') + '\n' : '')
}

export async function runImageAudit({
  checkOnly = false,
  publicDir = PUBLIC_DIR,
  reportFile = REPORT_FILE,
  missingFile = MISSING_FILE,
  fetchImpl = fetch,
  logger = console
} = {}) {
  const suppressionResult = await probeSuppression({fetchImpl})
  const disposition = suppressionDisposition(suppressionResult, 'image mirror audit', logger)
  if (disposition === 'skip') {
    return {status: 'suppressed', exitCode: 0}
  }
  if (disposition === 'fail') {
    return {status: 'overdue', exitCode: 1}
  }

  const manifests = await Promise.allSettled([
    fetchJson('books.json', fetchImpl),
    fetchJson('theatre-reviews.json', fetchImpl)
  ])
  const manifestErrors = manifests.map((result, index) =>
    result.status === 'rejected'
      ? `${index === 0 ? 'books.json' : 'theatre-reviews.json'}: ${result.reason.message}`
      : null
  ).filter(Boolean)

  if (manifestErrors.some((message) => message.includes('focus mode active'))) {
    const reprobe = await probeSuppression({fetchImpl})
    const retryDisposition = suppressionDisposition(reprobe, 'image mirror audit', logger)
    if (retryDisposition === 'skip') {
      return {status: 'suppressed', exitCode: 0}
    }
    if (retryDisposition === 'fail') {
      return {status: 'overdue', exitCode: 1}
    }
  }

  if (manifestErrors.length > 0) {
    const report = renderReport({manifestErrors})
    await writeReports(report, [], reportFile, missingFile)
    logger.error('INDETERMINATE: both image manifests are required.\n' + report)
    return {status: 'indeterminate', exitCode: 1, manifestErrors}
  }

  const urls = extractImageUrls(manifests[0].value, manifests[1].value)
  const localImages = await listLocalImages(publicDir)
  const drift = compareMirror(urls, localImages)
  const missingUrls = urls.filter((url) => drift.missingLocal.includes(imageRelativePath(url)))

  if (!checkOnly) {
    const downloads = await runWithConcurrency(urls, (url) => downloadImage(url, publicDir, fetchImpl))
    const failed = downloads.filter((result) => result.status === 'failed')
    for (const result of failed) {
      logger.error(`FAILED: ${result.url} (${result.reason})`)
    }
    if (drift.staleLocal.length > 0) {
      logger.warn('REVIEW PRUNE CANDIDATES (not deleted):\n' + drift.staleLocal.map((path) => `  ${path}`).join('\n'))
    }
    return {status: failed.length > 0 ? 'failed' : 'updated', exitCode: failed.length > 0 ? 1 : 0, downloads, ...drift}
  }

  const checks = await runWithConcurrency(urls,
    async (url) => ({url, remote: await verifyRemoteImage(url, fetchImpl), local: await verifyLocalImage(url, publicDir)}))
  const remoteFailures = checks.filter(({remote}) => !remote.ok).map(({url, remote}) => `${url}: ${remote.reason}`)
  const localFailures = checks.filter(({local}) => !local.ok).map(({url, local}) => `${url}: ${local.reason}`)
  const report = renderReport({...drift, remoteFailures, localFailures})
  await writeReports(report, missingUrls, reportFile, missingFile)
  logger.log(report)

  const failed = drift.missingLocal.length > 0 || drift.staleLocal.length > 0 || remoteFailures.length > 0 || localFailures.length > 0
  return {status: failed ? 'failed' : 'ok', exitCode: failed ? 1 : 0, ...drift, remoteFailures, localFailures}
}

async function main() {
  const result = await runImageAudit({checkOnly: process.argv.includes('--check-only')})
  process.exitCode = result.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('Image mirror audit crashed:', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
