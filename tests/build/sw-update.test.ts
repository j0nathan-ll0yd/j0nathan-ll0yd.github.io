import {describe, expect, it} from 'vitest'
import {existsSync, readFileSync} from 'fs'
import path from 'path'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
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
