import {existsSync, readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {clientDir, serverDir} from '../../scripts/lib/build-paths.mjs'
import {renderRedirectsFile} from '../../scripts/lib/redirects.mjs'
import {PROCESS_BANNER_MARKER} from '../../scripts/vite-client-no-process-banner.mjs'
import {renderHeadersFile} from '../../src/lib/edge/security-headers'

// The Workers build output (atlas decision 0160, PR A; plan Steps 3.1, 3.3 and 3.4).

const client = clientDir()
const server = serverDir()

describe('static-asset plane files', () => {
  it('writes _headers from the shared header module, not the adapter default', () => {
    expect(readFileSync(path.join(client, '_headers'), 'utf8')).toBe(renderHeadersFile())
  })

  it('writes a 308 _redirects rule for every built page', () => {
    const pages = readdirSync(client).filter((file) => file.endsWith('.html'))
    expect(pages.length).toBeGreaterThanOrEqual(4)
    expect(readFileSync(path.join(client, '_redirects'), 'utf8')).toBe(renderRedirectsFile(pages))
  })

  it('ships no Pages routing file', () => {
    expect(existsSync(path.join(client, '_routes.json'))).toBe(false)
  })

  it('stamps the platform marker into version.json', () => {
    expect(JSON.parse(readFileSync(path.join(client, 'version.json'), 'utf8'))).toMatchObject({runtime: 'workers'})
  })
})

describe('browser bundle', () => {
  it('carries no process global from the adapter banner', () => {
    const chunks = readdirSync(path.join(client, '_astro')).filter((file) => file.endsWith('.js'))
    expect(chunks.length).toBeGreaterThan(0)
    const bannered = chunks.filter((file) => readFileSync(path.join(client, '_astro', file), 'utf8').startsWith(PROCESS_BANNER_MARKER))
    expect(bannered).toEqual([])
  })
})

describe('Worker bundle', () => {
  const generated = JSON.parse(readFileSync(path.join(server, 'wrangler.json'), 'utf8')) as Record<string, unknown> & {
    assets: {directory: string; run_worker_first: string[]}
  }

  it('points the deploy at the static-asset directory', () => {
    expect(generated.assets.directory).toBe('../client')
    expect(generated.main).toBe('entry.mjs')
  })

  it('adds no binding the site does not use (no session KV, no Images)', () => {
    expect(generated.kv_namespaces ?? []).toEqual([])
    expect(generated.images).toBeUndefined()
    expect(generated.vars ?? {}).toEqual({})
  })

  it('keeps Version URLs and workers.dev off', () => {
    expect(generated.workers_dev).toBe(false)
    expect(generated.preview_urls).toBe(false)
  })

  it('carries no local secrets file', () => {
    expect(existsSync(path.join(server, '.dev.vars'))).toBe(false)
  })
})
