import fs from 'node:fs'
import path from 'node:path'
import * as cheerio from 'cheerio'
import {describe, expect, it} from 'vitest'
import {clientDir} from '../../scripts/lib/build-paths.mjs'

// Every other build test reads dist/ as the deployed site. tests/build/setup.ts must therefore
// build the production flavour: an inherited Vitest DEV, PROD, or MODE once built the dev branches
// of src/layouts/Dashboard.astro, and every build test passed against that dev page. No page
// carries DEV-only markup since the Leaflet loader left, so the PROD-only scripts are the marker: a
// dev-flavoured build drops them.
describe('build-test output flavour', () => {
  const $ = cheerio.load(fs.readFileSync(path.join(clientDir(), 'index.html'), 'utf8'))
  const scripts = $('script[src]').map((_, el) => $(el).attr('src')).get()

  it('carries the import.meta.env.PROD-only scripts', () => {
    expect(scripts).toEqual(expect.arrayContaining(['/js/sa-stub.js', '/js/sa-loader.js', '/js/scroll-depth.js', '/js/social-click-track.js']))
  })
})
