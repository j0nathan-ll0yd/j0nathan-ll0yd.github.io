import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {compareMirror, extractImageUrls, imageRelativePath, issueOutcome, runImageAudit, verifyRemoteImage} from '../../scripts/fetch-images.mjs'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'image-audit-'))
  tempDirs.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, {recursive: true, force: true})))
})

describe('image mirror helpers', () => {
  it('deduplicates every supported book and theatre image field', () => {
    const cover = `${CLOUDFRONT_BASE}/images/books/a.webp`
    const poster = `${CLOUDFRONT_BASE}/images/theatre/b.avif`
    expect(extractImageUrls({books: [{mainImage: cover, mainImageCard: cover}]}, {reviews: [{imageUrl: poster}]})).toEqual([cover, poster])
  })

  it('computes manifest-minus-local and local-minus-manifest', () => {
    const urls = [
      `${CLOUDFRONT_BASE}/images/books/a.webp`,
      `${CLOUDFRONT_BASE}/images/theatre/b.avif`
    ]
    expect(compareMirror(urls, ['images/books/a.webp', 'images/books/stale.webp'])).toEqual({
      missingLocal: ['images/theatre/b.avif'],
      staleLocal: ['images/books/stale.webp']
    })
    expect(imageRelativePath(urls[0])).toBe('images/books/a.webp')
  })

  it('requires an image content type and positive content length from HEAD', async () => {
    const ok = await verifyRemoteImage('https://example.com/a.webp',
      vi.fn().mockResolvedValue(new Response(null, {headers: {'Content-Type': 'image/webp', 'Content-Length': '42'}})))
    const empty = await verifyRemoteImage('https://example.com/a.webp',
      vi.fn().mockResolvedValue(new Response(null, {headers: {'Content-Type': 'image/webp', 'Content-Length': '0'}})))
    const wrongType = await verifyRemoteImage('https://example.com/a.webp',
      vi.fn().mockResolvedValue(new Response(null, {headers: {'Content-Type': 'text/html', 'Content-Length': '42'}})))

    expect(ok).toEqual({ok: true, contentType: 'image/webp', contentLength: 42})
    expect(empty).toEqual({ok: false, reason: 'content-length is 0'})
    expect(wrongType).toEqual({ok: false, reason: 'content-type is text/html'})
  })
})

describe('image mirror audit', () => {
  it('returns an honest non-failing SUPPRESSED result before fetching manifests', async () => {
    // hidingSince is what makes the window BOUNDED, and a bounded window is the only one this
    // audit may stand down on (atlas decision 0142). Without it there is no duration to check.
    const focus = {currentFocus: 'Work', hidingSince: new Date(Date.now() - 60_000).toISOString()}
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(focus)))

    const result = await runImageAudit({fetchImpl, checkOnly: true, logger: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}})

    expect(result).toEqual({status: 'suppressed', exitCode: 0})
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('reports a GATE CONTRADICTION, a managed-issue failure, when a hiding focus mode carries no hidingSince', async () => {
    const root = await tempDir()
    const gated = () => new Response(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 403})
    const fetchImpl = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/focus.json') ? new Response(JSON.stringify({currentFocus: 'Work'})) : gated())
    )
    const logger = {log: vi.fn(), warn: vi.fn(), error: vi.fn()}

    const result = await runImageAudit({
      fetchImpl,
      checkOnly: true,
      publicDir: join(root, 'public'),
      reportFile: join(root, 'report.txt'),
      missingFile: join(root, 'missing.txt'),
      logger
    })

    // Not `suppressed`: the probe answered, and what it answered establishes no 24-hour bound.
    // The focus contract requires hidingSince while hiding, so this is a contract violation with no
    // 24-hour bound. Leaving the issue unchanged would let it hide forever.
    expect(result.status).toBe('gate-contradiction')
    expect(issueOutcome(result.status)).toBe('failure')
    expect(result.exitCode).toBe(1)
    expect(result.manifestErrors).toEqual(['books.json: focus mode active', 'theatre-reviews.json: focus mode active'])
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('INDETERMINATE: suppression evidence incomplete'))
  })

  it('is UNREACHABLE, nonzero and a managed-issue failure when a manifest returns a non-disclosure status', async () => {
    const root = await tempDir()
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({currentFocus: 'Personal'}))).mockResolvedValueOnce(
      new Response('down', {status: 503})
    ).mockResolvedValueOnce(new Response(JSON.stringify({reviews: []})))

    const result = await runImageAudit({
      fetchImpl,
      checkOnly: true,
      publicDir: join(root, 'public'),
      reportFile: join(root, 'report.txt'),
      missingFile: join(root, 'missing.txt'),
      logger: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}
    })

    expect(result.status).toBe('unreachable')
    expect(result.exitCode).toBe(1)
    expect(issueOutcome(result.status)).toBe('failure')
  })

  it('is UNREACHABLE and a managed-issue failure on a transport error, the 2026-08-28 to 2026-10-10 blind state', async () => {
    // The shape every deploy printed without the cfedge lane: undici rejects with `fetch failed`
    // for the focus probe and both manifests. That must never read as a focus-gate stand-down.
    const root = await tempDir()
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const logger = {log: vi.fn(), warn: vi.fn(), error: vi.fn()}

    const result = await runImageAudit({
      fetchImpl,
      checkOnly: true,
      publicDir: join(root, 'public'),
      reportFile: join(root, 'report.txt'),
      missingFile: join(root, 'missing.txt'),
      logger
    })

    expect(result).toEqual({status: 'unreachable', exitCode: 1, manifestErrors: ['books.json: fetch failed', 'theatre-reviews.json: fetch failed']})
    expect(issueOutcome(result.status)).toBe('failure')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('focus.json probe failed: fetch failed'))
  })

  it('is UNREACHABLE when one manifest is gated and the other fails in transport', async () => {
    const root = await tempDir()
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/focus.json')) {
        return Promise.resolve(new Response(JSON.stringify({currentFocus: 'Work'})))
      }
      if (url.endsWith('/books.json')) {
        return Promise.resolve(new Response(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 403}))
      }
      return Promise.reject(new TypeError('fetch failed'))
    })

    const result = await runImageAudit({
      fetchImpl,
      checkOnly: true,
      publicDir: join(root, 'public'),
      reportFile: join(root, 'report.txt'),
      missingFile: join(root, 'missing.txt'),
      logger: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}
    })

    expect(result.status).toBe('unreachable')
    expect(issueOutcome(result.status)).toBe('failure')
  })

  async function auditWith(focusResponses: Array<() => Promise<Response>>, manifest: (url: string) => Promise<Response>) {
    const root = await tempDir()
    const probes = [...focusResponses]
    const fetchImpl = vi.fn().mockImplementation((url: string) => url.endsWith('/focus.json') ? probes.shift()!() : manifest(url))
    const result = await runImageAudit({
      fetchImpl,
      checkOnly: true,
      publicDir: join(root, 'public'),
      reportFile: join(root, 'report.txt'),
      missingFile: join(root, 'missing.txt'),
      logger: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}
    })
    return {result, fetchImpl}
  }
  const gatedManifest = () => Promise.resolve(new Response(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 403}))
  const focus = (body: object) => () => Promise.resolve(new Response(JSON.stringify(body)))

  it('reports a GATE CONTRADICTION when focus is visible but the gate denies the manifests', async () => {
    const visible = focus({generatedAt: '2026-10-10T00:00:00Z', currentFocus: 'None'})
    const {result} = await auditWith([visible, visible], gatedManifest)

    expect(result.status).toBe('gate-contradiction')
    expect(issueOutcome(result.status)).toBe('failure')
  })

  it('reports a GATE CONTRADICTION when the focus probe fails in transport and the gate denies the manifests', async () => {
    const down = () => Promise.reject(new TypeError('fetch failed'))
    const {result} = await auditWith([down, down], gatedManifest)

    expect(result.status).toBe('gate-contradiction')
    expect(issueOutcome(result.status)).toBe('failure')
  })

  it('stands down as SUPPRESSED when focus starts hiding mid-run and the reprobe establishes a bounded window', async () => {
    const visible = focus({generatedAt: '2026-10-10T00:00:00Z', currentFocus: 'None'})
    const hiding = focus({generatedAt: '2026-10-10T00:00:00Z', currentFocus: 'Work', hidingSince: new Date(Date.now() - 60_000).toISOString()})
    // One manifest answered before the gate closed, the other after: a partial gate.
    const {result} = await auditWith([visible, hiding],
      (url) => url.endsWith('/books.json') ? Promise.resolve(new Response(JSON.stringify({books: []}))) : gatedManifest())

    expect(result).toEqual({status: 'suppressed', exitCode: 0})
    expect(issueOutcome(result.status)).toBe('indeterminate')
  })

  it('reports a GATE CONTRADICTION on a partial gate the reprobe cannot explain', async () => {
    const visible = focus({generatedAt: '2026-10-10T00:00:00Z', currentFocus: 'None'})
    const {result} = await auditWith([visible, visible],
      (url) => url.endsWith('/books.json') ? Promise.resolve(new Response(JSON.stringify({books: []}))) : gatedManifest())

    expect(result.status).toBe('gate-contradiction')
    expect(issueOutcome(result.status)).toBe('failure')
  })

  it('maps every check-mode status onto the reconciler tri-state, failing closed', () => {
    expect(issueOutcome('ok')).toBe('success')
    expect(issueOutcome('failed')).toBe('failure')
    expect(issueOutcome('overdue')).toBe('failure')
    expect(issueOutcome('unreachable')).toBe('failure')
    expect(issueOutcome('crashed')).toBe('failure')
    expect(issueOutcome('suppressed')).toBe('indeterminate')
    expect(issueOutcome('gate-contradiction')).toBe('failure')
    expect(issueOutcome('gated')).toBe('failure')
  })

  it('reports OK and a managed-issue success when the mirror matches and every object verifies', async () => {
    const root = await tempDir()
    const publicDir = join(root, 'public')
    await mkdir(join(publicDir, 'images', 'books'), {recursive: true})
    await writeFile(join(publicDir, 'images', 'books', 'a.webp'), Buffer.from([1]))
    const url = `${CLOUDFRONT_BASE}/images/books/a.webp`
    const fetchImpl = vi.fn().mockImplementation((input: string) => {
      if (input.endsWith('/focus.json')) {
        return Promise.resolve(new Response(JSON.stringify({currentFocus: 'Personal'})))
      }
      if (input.endsWith('/books.json')) {
        return Promise.resolve(new Response(JSON.stringify({books: [{mainImage: url}]})))
      }
      if (input.endsWith('/theatre-reviews.json')) {
        return Promise.resolve(new Response(JSON.stringify({reviews: []})))
      }
      return Promise.resolve(new Response(null, {headers: {'Content-Type': 'image/webp', 'Content-Length': '1'}}))
    })

    const result = await runImageAudit({
      fetchImpl,
      checkOnly: true,
      publicDir,
      reportFile: join(root, 'report.txt'),
      missingFile: join(root, 'missing.txt'),
      logger: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}
    })

    expect(result.status).toBe('ok')
    expect(result.exitCode).toBe(0)
    expect(issueOutcome(result.status)).toBe('success')
  })

  it('HEAD-checks existing objects and reports reviewed prune candidates without deleting them', async () => {
    const root = await tempDir()
    const publicDir = join(root, 'public')
    await mkdir(join(publicDir, 'images', 'books'), {recursive: true})
    await writeFile(join(publicDir, 'images', 'books', 'a.webp'), Buffer.from([1]))
    await writeFile(join(publicDir, 'images', 'books', 'stale.webp'), Buffer.from([1]))
    const url = `${CLOUDFRONT_BASE}/images/books/a.webp`
    const fetchImpl = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.endsWith('/focus.json')) {
        return Promise.resolve(new Response(JSON.stringify({currentFocus: 'Personal'})))
      }
      if (input.endsWith('/books.json')) {
        return Promise.resolve(new Response(JSON.stringify({books: [{mainImage: url}]})))
      }
      if (input.endsWith('/theatre-reviews.json')) {
        return Promise.resolve(new Response(JSON.stringify({reviews: []})))
      }
      if (input === url && init?.method === 'HEAD') {
        return Promise.resolve(new Response(null, {headers: {'Content-Type': 'image/webp', 'Content-Length': '1'}}))
      }
      throw new Error(`unexpected fetch ${input}`)
    })

    const result = await runImageAudit({
      fetchImpl,
      checkOnly: true,
      publicDir,
      reportFile: join(root, 'report.txt'),
      missingFile: join(root, 'missing.txt'),
      logger: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}
    })

    expect(result.exitCode).toBe(1)
    expect(result.remoteFailures).toEqual([])
    expect(result.staleLocal).toEqual(['images/books/stale.webp'])
    expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({method: 'HEAD'}))
  })
})
