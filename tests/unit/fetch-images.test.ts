import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {compareMirror, extractImageUrls, imageRelativePath, runImageAudit, verifyRemoteImage} from '../../scripts/fetch-images.mjs'

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
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({currentFocus: 'Work'})))

    const result = await runImageAudit({fetchImpl, checkOnly: true, logger: {log: vi.fn(), warn: vi.fn(), error: vi.fn()}})

    expect(result).toEqual({status: 'suppressed', exitCode: 0})
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('is indeterminate and nonzero unless both manifests are available', async () => {
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

    expect(result.status).toBe('indeterminate')
    expect(result.exitCode).toBe(1)
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
