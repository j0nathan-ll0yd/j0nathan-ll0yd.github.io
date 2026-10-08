import {describe, expect, it} from 'vitest'
import {existsSync, readFileSync} from 'fs'
import path from 'path'
import {runInNewContext} from 'node:vm'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'

// Graceful no-interaction deploy updates (Phase 1).
// Plan: .omc/plans/graceful-deploy-auto-update-plan.md
const distDir = path.resolve(process.cwd(), 'dist')
const swRegisterPath = path.join(distDir, 'js', 'sw-register.js')

describe('SW update controller', () => {
  it('dist/js/sw-register.js exists', () => {
    expect(existsSync(swRegisterPath)).toBe(true)
  })

  it('is ES5 only (ships verbatim, no transpile)', () => {
    const src = readFileSync(swRegisterPath, 'utf-8')
    const forbidden: Array<[string, RegExp]> = [
      ['arrow function', /=>/],
      ['const', /\bconst\b/],
      ['let', /\blet\b/],
      ['template literal', /`/],
      ['class', /\bclass\b/],
      ['optional chaining', /\?\./],
      ['nullish coalescing', /\?\?/]
    ]
    const hits = forbidden.filter(([, re]) => re.test(src)).map(([name]) => name)
    expect(hits).toEqual([])
  })

  it('wires the controllerchange reload spine and the update nudge', () => {
    const src = readFileSync(swRegisterPath, 'utf-8')
    expect(src).toContain("addEventListener('controllerchange'")
    expect(src).toContain('window.__checkForSwUpdate')
    expect(src).toContain("register('/sw.js')")
  })

  it('does not ship vite-plugin-pwa registerSW.js (injectRegister:false)', () => {
    expect(existsSync(path.join(distDir, 'registerSW.js'))).toBe(false)
  })
})

// Atlas decision 0160, PR 0b (adversarial finding H02). The retired `live-data` NetworkFirst route
// cached focus.json and every CloudFront JSON export, and replayed them after a 3 s timeout or
// offline. These read the GENERATED worker, not the config, so a plugin or config regression that
// reintroduces such a route reds here as well as in scripts/check-sw-precache.mjs.
describe('SW gated-data privacy', () => {
  const swPath = path.join(distDir, 'sw.js')
  const purgePath = path.join(distDir, 'js', 'sw-purge.js')

  it('declares no live-data cache and imports the purge script', () => {
    const sw = readFileSync(swPath, 'utf-8')
    expect(sw).not.toMatch(/cacheName["']?\s*:\s*["']live-data["']/)
    expect(sw).not.toContain('NetworkFirst')
    expect(sw).toContain('importScripts("/js/sw-purge.js")')
  })

  it('registers no runtime route that matches focus.json or any CloudFront JSON export', () => {
    const sw = readFileSync(swPath, 'utf-8')
    const matchers = [...sw.matchAll(/registerRoute\(\s*(\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n[])+\/[a-z]*)/g)].map((m) => {
      const literal = m[1]
      const close = literal.lastIndexOf('/')
      return new RegExp(literal.slice(1, close), literal.slice(close + 1))
    })
    const routeCount = (sw.match(/registerRoute\(/g) ?? []).length
    expect(matchers).toHaveLength(routeCount) // every route has a readable regex matcher
    const gated = Object.values(ENDPOINTS).filter((p) => p.endsWith('.json')).flatMap((p) => [`${CLOUDFRONT_BASE}${p}`, `${CLOUDFRONT_BASE}${p}?_poll=1`])
    expect(gated).toContain(`${CLOUDFRONT_BASE}/focus.json`)
    for (const matcher of matchers) {
      expect(gated.filter((url) => matcher.test(url)), `${matcher} must not match a gated URL`).toEqual([])
    }
  })

  it('deletes the live-data cache on activate when run in a service-worker scope', async () => {
    const listeners: Record<string, (event: {waitUntil(p: Promise<unknown>): void}) => void> = {}
    const deleted: string[] = []
    const sandbox = {
      self: {addEventListener: (type: string, fn: (event: {waitUntil(p: Promise<unknown>): void}) => void) => (listeners[type] = fn)},
      caches: {delete: (name: string) => (deleted.push(name), Promise.resolve(true))},
      Promise
    }
    runInNewContext(readFileSync(purgePath, 'utf-8'), sandbox)

    let pending: Promise<unknown> = Promise.resolve()
    listeners.activate?.({waitUntil: (p) => (pending = p)})
    await pending

    expect(Object.keys(listeners)).toEqual(['activate'])
    expect(deleted).toEqual(['live-data'])
  })

  it('still activates when the cache delete rejects', async () => {
    let activate: ((event: {waitUntil(p: Promise<unknown>): void}) => void) | undefined
    runInNewContext(readFileSync(purgePath, 'utf-8'), {
      self: {addEventListener: (_type: string, fn: typeof activate) => (activate = fn)},
      caches: {delete: () => Promise.reject(new Error('quota'))},
      Promise
    })
    let pending: Promise<unknown> = Promise.resolve()
    activate?.({waitUntil: (p) => (pending = p)})
    await expect(pending).resolves.toBeDefined()
  })
})
