import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {extractLocs, validateAgainstSchema} from '../../scripts/audit/validate-sitemap.mjs'
import {validateSitemapDocument} from '../../scripts/audit/lib/sitemap-schema.mjs'
import {SITEMAP_SCHEMA_CASES} from './fixtures/sitemap-schema-cases.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = (name: string) => path.join(__dirname, 'fixtures', name)
const vendorPath = (name: string) => path.join(__dirname, '..', '..', 'scripts', 'audit', 'vendor', name)
const XSD_FOR_PROFILE = {urlset: 'sitemap-0.9.xsd', sitemapindex: 'siteindex-0.9.xsd'} as const

describe('extractLocs', () => {
  it('extracts every <loc> text content from a flat urlset', () => {
    const xml = '<urlset><url><loc>https://a.example/</loc></url><url><loc>https://a.example/b</loc></url></urlset>'
    expect(extractLocs(xml)).toEqual(['https://a.example/', 'https://a.example/b'])
  })

  it('returns an empty array when there are no <loc> tags', () => {
    expect(extractLocs('<urlset></urlset>')).toEqual([])
  })
})

// These run EVERYWHERE -- no system binary, so no describe.skipIf. The previous
// revision shelled out to xmllint and skipped whenever it was absent, which is
// how the XSD assertions stayed silently unexercised in most CI contexts.
describe('validateSitemapDocument (known answers from xmllint --schema, libxml 20913)', () => {
  for (const testCase of SITEMAP_SCHEMA_CASES) {
    it(`${testCase.valid ? 'accepts' : 'rejects'}: ${testCase.name}`, () => {
      const violations = validateSitemapDocument(testCase.xml, testCase.profile)
      expect(violations.length === 0, `expected ${testCase.valid ? 'valid' : 'invalid'}, got: ${violations.join(' | ')}`).toBe(testCase.valid)
    })
  }

  it('covers both document profiles', () => {
    const profiles = new Set(SITEMAP_SCHEMA_CASES.map((c) => c.profile))
    expect([...profiles].sort()).toEqual(['sitemapindex', 'urlset'])
  })

  it('throws on an unknown profile rather than passing the document', () => {
    expect(() => validateSitemapDocument('<urlset/>', 'nope')).toThrow(/unknown sitemap profile/)
  })
})

describe('validateAgainstSchema (finding shape)', () => {
  it('a schema-conformant urlset produces zero findings', () => {
    const xml = readFileSync(fixturePath('sitemap-valid.xml'), 'utf8')
    expect(validateAgainstSchema('sitemap-child-xsd', xml, 'urlset', 'https://example.com/sitemap-0.xml')).toEqual([])
  })

  it('known-answer: a <priority> outside the 0.0-1.0 range fails validation', () => {
    const xml = readFileSync(fixturePath('sitemap-invalid.xml'), 'utf8')
    const findings = validateAgainstSchema('sitemap-child-xsd', xml, 'urlset', 'https://example.com/sitemap-0.xml')
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('fail')
    expect(findings[0].id).toBe('sitemap-child-xsd')
    expect(findings[0].message).toContain('sitemap-0.xml')
    expect(findings[0].message).toContain('priority')
  })

  it('collapses every violation in one document into a single finding', () => {
    const xml = '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + '<url><priority>9</priority></url></urlset>'
    const findings = validateAgainstSchema('sitemap-child-xsd', xml, 'urlset', 'https://example.com/sitemap-0.xml')
    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain('missing required <loc>')
    expect(findings[0].message).toContain('outside the permitted range')
  })
})

// Opportunistic differential: when xmllint IS available (macOS dev machines,
// any image that ships libxml2-utils) re-derive every expectation in the case
// table from the real schema processor. This is what keeps the hard-coded
// `valid` flags honest. Its absence can no longer hide a broken validator --
// the known-answer suite above already covered every case unconditionally.
function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasXmllint())('differential vs real xmllint --schema', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'sitemap-xsd-'))

  it.each(SITEMAP_SCHEMA_CASES.map((c, i) => [i, c] as const))('case %i agrees: %s', (index, testCase) => {
    const file = path.join(scratch, `case-${index}.xml`)
    writeFileSync(file, testCase.xml)
    let xmllintValid: boolean
    try {
      execFileSync('xmllint', ['--noout', '--schema', vendorPath(XSD_FOR_PROFILE[testCase.profile]), file], {stdio: 'pipe'})
      xmllintValid = true
    } catch {
      xmllintValid = false
    }
    expect(xmllintValid, 'the recorded `valid` flag no longer matches xmllint').toBe(testCase.valid)
    expect(validateSitemapDocument(testCase.xml, testCase.profile).length === 0).toBe(xmllintValid)
  })
})
