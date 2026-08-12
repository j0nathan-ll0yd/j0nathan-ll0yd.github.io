import {describe, expect, it} from 'vitest'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {extractLocs, validateAgainstXsd} from '../../scripts/audit/validate-sitemap.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = (name: string) => path.join(__dirname, 'fixtures', name)
const vendorPath = (name: string) => path.join(__dirname, '..', '..', 'scripts', 'audit', 'vendor', name)

// `pnpm run test:unit` is invoked from several places in this repo (its own
// package.json script, and as a pre-check step inside visual-tests.yml) that
// have nothing to do with the audit-web.yml workflow and are not guaranteed
// to have xmllint on PATH -- unlike audit-web.yml's weekly job, which
// explicitly apt-get installs libxml2-utils because validate-sitemap.mjs
// genuinely needs it at runtime. A "unit test" that hard-fails because an
// unrelated CI job lacks a system binary is a test design bug, not a real
// finding (reproduced: visual-tests.yml's setup job failed with `spawnSync
// xmllint ENOENT` after this test file's include glob was added to the
// shared vitest.unit.config.ts). Skip gracefully instead.
function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}
const xmllintAvailable = hasXmllint()

describe('extractLocs', () => {
  it('extracts every <loc> text content from a flat urlset', () => {
    const xml = '<urlset><url><loc>https://a.example/</loc></url><url><loc>https://a.example/b</loc></url></urlset>'
    expect(extractLocs(xml)).toEqual(['https://a.example/', 'https://a.example/b'])
  })

  it('returns an empty array when there are no <loc> tags', () => {
    expect(extractLocs('<urlset></urlset>')).toEqual([])
  })
})

describe.skipIf(!xmllintAvailable)('validateAgainstXsd (real xmllint + vendored sitemaps.org 0.9 XSD)', () => {
  it('a schema-conformant urlset produces zero findings', () => {
    const findings = validateAgainstXsd('sitemap-child-xsd', fixturePath('sitemap-valid.xml'), vendorPath('sitemap-0.9.xsd'),
      'https://example.com/sitemap-0.xml')
    expect(findings).toEqual([])
  })

  it('known-answer: a <priority> outside the 0.0-1.0 range fails XSD validation', () => {
    const findings = validateAgainstXsd('sitemap-child-xsd', fixturePath('sitemap-invalid.xml'), vendorPath('sitemap-0.9.xsd'),
      'https://example.com/sitemap-0.xml')
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('fail')
    expect(findings[0].message).toContain('sitemap-0.xml')
  })
})
