// audits/lib/sitemap-schema.mjs transcribes the vendored sitemaps.org
// 0.9 XSDs into JavaScript so validate-sitemap.mjs no longer needs an
// apt-installed xmllint on an egress-isolated runner. The XSDs stay the
// normative source of record; this suite re-derives every transcribed facet
// FROM the .xsd files and asserts the module still matches, so editing a schema
// without editing the validator fails here instead of silently weakening B2.

import {readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {XMLParser} from 'fast-xml-parser'
import {CHANGEFREQ_VALUES, LOC_FACETS, PRIORITY_FACETS, PROFILES, SITEMAP_NS} from '../lib/sitemap-schema.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const vendorDir = path.join(__dirname, '..', 'vendor')

// isArray on ELEMENTS only (never on `@_` attributes, which must stay scalars),
// so single-occurrence declarations still arrive as one-element arrays and the
// traversal below does not need to special-case them.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name: string) => !name.startsWith('@_')
})

interface Node {
  [key: string]: unknown
}

function loadSchema(file: string): Node {
  return parser.parse(readFileSync(path.join(vendorDir, file), 'utf8'))['xsd:schema'][0] as Node
}

/** Every descendant node under `key` anywhere in the subtree, depth-first. */
function collect(node: unknown, key: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      collect(item, key, out)
    }
    return out
  }
  if (node === null || typeof node !== 'object') {
    return out
  }
  for (const [childKey, value] of Object.entries(node as Node)) {
    if (childKey === key && Array.isArray(value)) {
      out.push(...(value as Node[]))
    }
    collect(value, key, out)
  }
  return out
}

function namedType(schema: Node, kind: 'xsd:complexType' | 'xsd:simpleType', name: string): Node {
  const match = ((schema[kind] as Node[]) || []).find((t) => t['@_name'] === name)
  if (!match) {
    throw new Error(`${kind} "${name}" not found in schema`)
  }
  return match
}

const SCHEMAS = {urlset: loadSchema(PROFILES.urlset.xsd), sitemapindex: loadSchema(PROFILES.sitemapindex.xsd)} as const

describe.each(['urlset', 'sitemapindex'] as const)('%s profile matches its vendored XSD', (profileName) => {
  const profile = PROFILES[profileName]
  const schema = SCHEMAS[profileName]

  it('targets the sitemaps.org 0.9 namespace and qualifies element form', () => {
    expect(schema['@_targetNamespace']).toBe(SITEMAP_NS)
    expect(schema['@_elementFormDefault']).toBe('qualified')
  })

  it('declares exactly the transcribed root element', () => {
    const roots = (schema['xsd:element'] as Node[]).map((el) => el['@_name'])
    expect(roots).toEqual([profile.root])
  })

  it('root contains an unbounded sequence of the transcribed entry element', () => {
    const rootSequence = collect(schema['xsd:element'], 'xsd:element')
    expect(rootSequence).toHaveLength(1)
    expect(rootSequence[0]['@_name']).toBe(profile.entry)
    expect(rootSequence[0]['@_type']).toBe(profile.entryType)
    expect(rootSequence[0]['@_maxOccurs']).toBe('unbounded')
    // minOccurs is absent, i.e. the XSD default of 1 -- the validator's "no
    // entries is a violation" rule depends on that.
    expect(rootSequence[0]['@_minOccurs']).toBeUndefined()
  })

  it('the entry complexType sequence matches PROFILES.fields in order, name and optionality', () => {
    const entryType = namedType(schema, 'xsd:complexType', profile.entryType)
    const declared = collect(entryType, 'xsd:element').map((el) => ({name: el['@_name'], required: el['@_minOccurs'] === undefined}))
    expect(declared).toEqual(profile.fields.map((field: {name: string; required: boolean}) => ({name: field.name, required: field.required})))
  })

  it('the entry complexType declares no attributes', () => {
    const entryType = namedType(schema, 'xsd:complexType', profile.entryType)
    expect(collect(entryType, 'xsd:attribute')).toHaveLength(0)
  })

  it('admits foreign-namespace content only through a strict ##other wildcard', () => {
    const wildcards = collect(schema, 'xsd:any')
    expect(wildcards.length).toBeGreaterThan(0)
    for (const wildcard of wildcards) {
      expect(wildcard['@_namespace']).toBe('##other')
      // processContents="strict" is why the validator rejects EVERY foreign
      // element: no schema is loaded for those namespaces.
      expect(wildcard['@_processContents']).toBe('strict')
    }
  })

  it('the loc simpleType length facets match LOC_FACETS', () => {
    const locType = namedType(schema, 'xsd:simpleType', profileName === 'urlset' ? 'tLoc' : 'tLocSitemap')
    expect(Number(collect(locType, 'xsd:minLength')[0]['@_value'])).toBe(LOC_FACETS.minLength)
    expect(Number(collect(locType, 'xsd:maxLength')[0]['@_value'])).toBe(LOC_FACETS.maxLength)
    expect(collect(locType, 'xsd:restriction')[0]['@_base']).toBe('xsd:anyURI')
  })

  it('the lastmod simpleType is still a union of xsd:date and xsd:dateTime', () => {
    const lastmodType = namedType(schema, 'xsd:simpleType', profileName === 'urlset' ? 'tLastmod' : 'tLastmodSitemap')
    expect(collect(lastmodType, 'xsd:union')).toHaveLength(1)
    expect(collect(lastmodType, 'xsd:restriction').map((r) => r['@_base']).sort()).toEqual(['xsd:date', 'xsd:dateTime'])
  })
})

describe('urlset-only simpleTypes', () => {
  it('the tChangeFreq enumeration matches CHANGEFREQ_VALUES, in order', () => {
    const changefreq = namedType(SCHEMAS.urlset, 'xsd:simpleType', 'tChangeFreq')
    expect(collect(changefreq, 'xsd:enumeration').map((e) => e['@_value'])).toEqual([...CHANGEFREQ_VALUES])
  })

  it('the tPriority bounds and base type match PRIORITY_FACETS', () => {
    const priority = namedType(SCHEMAS.urlset, 'xsd:simpleType', 'tPriority')
    // xsd:decimal (not xsd:double) is what makes "1e-1" and "INF" invalid.
    expect(collect(priority, 'xsd:restriction')[0]['@_base']).toBe('xsd:decimal')
    expect(Number(collect(priority, 'xsd:minInclusive')[0]['@_value'])).toBe(PRIORITY_FACETS.minInclusive)
    expect(Number(collect(priority, 'xsd:maxInclusive')[0]['@_value'])).toBe(PRIORITY_FACETS.maxInclusive)
  })

  it('tSitemap has no changefreq or priority, unlike tUrl', () => {
    const names = collect(namedType(SCHEMAS.sitemapindex, 'xsd:complexType', 'tSitemap'), 'xsd:element').map((el) => el['@_name'])
    expect(names).not.toContain('changefreq')
    expect(names).not.toContain('priority')
  })
})
