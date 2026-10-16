import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildId, COMPOSER_CONTRACT, composerPath} from '../../scripts/lib/build-id.mjs'
import {clientDir, serverDir} from '../../scripts/lib/build-paths.mjs'
import {canonicalPagePaths, renderRedirectsFile} from '../../scripts/lib/redirects.mjs'
import {PROCESS_BANNER_MARKER} from '../../scripts/vite-client-no-process-banner.mjs'
import {renderHeadersFile} from '../../src/lib/edge/security-headers'

// The Workers build output (atlas decision 0160, PR A; plan Steps 3.1, 3.3 and 3.4).

const client = clientDir()
const server = serverDir()

describe('static-asset plane files', () => {
  it('writes _headers from the shared header module, not the adapter default', () => {
    const pages = readdirSync(client).filter((file) => file.endsWith('.html'))
    expect(readFileSync(path.join(client, '_headers'), 'utf8')).toBe(renderHeadersFile(canonicalPagePaths(pages)))
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

  it('carries no route into the deploy config, so a deploy makes no route call', () => {
    expect(generated.routes ?? []).toEqual([])
  })

  it('keeps workers.dev off and Version URLs on (behind Access since gate G3)', () => {
    expect(generated.workers_dev).toBe(false)
    expect(generated.preview_urls).toBe(true)
  })

  it('carries no local secrets file', () => {
    expect(existsSync(path.join(server, '.dev.vars'))).toBe(false)
  })
})

describe('the shipped composer (atlas decision 0160, PR B; owner decision 2026-10-16)', () => {
  const version = JSON.parse(readFileSync(path.join(client, 'version.json'), 'utf8')) as {
    build: string
    composer: {path: string; sha256: string; contract: number}
  }

  // covers: dashboard-ssr#The Worker serves only an artifact its own build composed
  it('names this build, its composer path, the composer sha256 and the contract in version.json', () => {
    expect(version.build).toBe(buildId())
    expect(version.composer.path).toBe(composerPath(version.build))
    expect(version.composer.contract).toBe(COMPOSER_CONTRACT)
    const bytes = readFileSync(path.join(client, version.composer.path))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(version.composer.sha256)
  })

  it('ships a composer stamped with the same build, so its artifacts pass the Worker lockstep check', async () => {
    const composer = (await import(pathToFileURL(path.join(client, version.composer.path)).href)) as {COMPOSER_BUILD: string; COMPOSER_CONTRACT: number}
    expect(composer.COMPOSER_BUILD).toBe(version.build)
    expect(composer.COMPOSER_CONTRACT).toBe(version.composer.contract)
  })

  it('ships exactly one composer, and no machine path or fixture inside it', () => {
    expect(readdirSync(path.join(client, '_ssr')).filter((file) => file.startsWith('composer-'))).toEqual([path.basename(version.composer.path)])
    const text = readFileSync(path.join(client, version.composer.path), 'utf8')
    expect(text).not.toContain(process.cwd())
    expect(text).not.toMatch(/fixtures\/generated/)
  })
})
