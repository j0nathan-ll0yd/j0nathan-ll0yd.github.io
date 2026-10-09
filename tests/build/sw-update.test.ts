import {describe, expect, it} from 'vitest'
import {existsSync, readdirSync, readFileSync, statSync} from 'fs'
import path from 'path'
import {CLOUDFRONT_BASE, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {scanWorkerSource, scanWorkerTree, siteGatedProbeUrls, verifyPurgeScript} from '../../scripts/lib/sw-privacy.mjs'

// Graceful no-interaction deploy updates (Phase 1).
// Plan: .omc/plans/graceful-deploy-auto-update-plan.md
const distDir = path.resolve(process.cwd(), 'dist')
const swRegisterPath = path.join(distDir, 'js', 'sw-register.js')

describe('SW update controller', () => {
  it('dist/js/sw-register.js exists', () => {
    expect(existsSync(swRegisterPath)).toBe(true)
  })

  it.each(['sw-register.js', 'sw-purge.js'])('%s is ES5 only (ships verbatim, no transpile)', (file) => {
    const src = readFileSync(path.join(distDir, 'js', file), 'utf-8')
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

// covers: client-privacy#No service-worker path caches a gated response
// Atlas decision 0160, PR 0b (adversarial finding H02). The retired `live-data` NetworkFirst route
// cached focus.json and every CloudFront JSON export, and replayed them after a 3 s timeout or
// offline. These read the GENERATED worker through the same scan the postbuild gate runs
// (scripts/lib/sw-privacy.mjs), so a plugin or config regression reds here too.
describe('SW gated-data privacy', () => {
  const swPath = path.join(distDir, 'sw.js')
  const purgePath = path.join(distDir, 'js', 'sw-purge.js')

  it('has no gated route, unrouted handler, gated precache entry or live-data cache, in the worker or anything it imports', () => {
    const readWorkerFile = (file: string) => (existsSync(path.join(distDir, file)) ? readFileSync(path.join(distDir, file), 'utf-8') : null)
    expect(scanWorkerTree({entry: '/sw.js', readWorkerFile, gatedUrls: siteGatedProbeUrls(), siteUrl: SITE_URL})).toEqual([])
    expect(readFileSync(swPath, 'utf-8')).not.toContain('NetworkFirst')
  })

  it('ships a purge script that deletes live-data on activate when run in a worker scope', async () => {
    const purge = readFileSync(purgePath, 'utf-8')
    expect(scanWorkerSource(purge, {gatedUrls: siteGatedProbeUrls(), label: 'sw-purge.js'})).toEqual([])
    expect(await verifyPurgeScript(purge)).toEqual([])
  })
})

// covers: client-privacy#Navigations go to the network, and only the data-free /offline page answers offline
// The built /offline document itself: data-free, and carrying none of the live-data plumbing. The
// real-Chromium navigation behavior is tests/behavioral/offline-navigation.spec.ts.
describe('the data-free /offline page', () => {
  const html = () => readFileSync(path.join(distDir, 'offline', 'index.html'), 'utf-8')

  it('is built, marked, and kept out of search', () => {
    expect(html()).toContain('data-offline-page')
    expect(html()).toMatch(/<meta name="robots" content="noindex, nofollow">/)
  })

  it('holds no live widget, gated-data request, data-reading script or analytics', () => {
    // Judge the markup, not the inlined site stylesheet, whose selectors name every widget class.
    const page = html().replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    for (
      const forbidden of [
        'tri-card',
        'is-loading',
        'cardHR',
        'focusOverlay',
        'rel="prefetch"',
        'application/ld+json',
        '/js/webmcp.js',
        '/js/sa-loader.js',
        '/cf-insights.js',
        new URL(CLOUDFRONT_BASE).host
      ]
    ) {
      expect(page, `offline page contains ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('is the only HTML document the worker precaches', () => {
    const sw = readFileSync(path.join(distDir, 'sw.js'), 'utf-8')
    const documents = [...sw.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((url) =>
      url === '/' || url.endsWith('.html') || !/\.[a-z0-9]+$/i.test(url)
    )
    expect(documents).toEqual(['offline'])
  })
})

// covers: client-privacy#No page prefetches gated data
// The browser HTTP cache is a cache too. A <link rel="prefetch"> of a gated export stored it for
// minutes after the owner may have hidden it, and the client never read that copy (every runtime
// read is `cache: 'no-store'`). No built page may prefetch CloudFront data.
describe('no built page prefetches gated data', () => {
  const htmlFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const file = path.join(dir, name)
      return statSync(file).isDirectory() ? htmlFiles(file) : file.endsWith('.html') ? [file] : []
    })

  it.each(htmlFiles(distDir).map((file) => [path.relative(distDir, file)]))('%s has no prefetch of CloudFront data', (relative) => {
    const page = readFileSync(path.join(distDir, relative), 'utf-8')
    const prefetches = [...page.matchAll(/<link[^>]*rel="(?:prefetch|preload)"[^>]*>/g)].map((m) => m[0])
    expect(prefetches.filter((tag) => tag.includes(new URL(CLOUDFRONT_BASE).host))).toEqual([])
  })
})
