// scripts/audit/lib/sitemap-schema.mjs -- pure-Node validation of the
// sitemaps.org 0.9 schemas (scripts/audit/vendor/{sitemap,siteindex}-0.9.xsd),
// built on the two XML packages already in this repo's dependency tree:
// `fast-xml-validator` SyntaxValidator for well-formedness and
// `fast-xml-parser` XMLParser for the structural walk. Same pairing, and the
// same throw-vs-return contract note, as check-feeds.mjs.
//
// WHY THIS IS NOT `xmllint --schema` ANY MORE. validate-sitemap.mjs used to
// shell out to xmllint, which meant audit-web.yml had to `apt-get install
// libxml2-utils` on every weekly run. The self-hosted arm64 runners sit behind
// a default-deny egress allowlist (ci-runners-private) that does not include
// ports.ubuntu.com or deb.nodesource.com, so that step exited 100 and killed
// the whole report-only job before any validator ran -- three consecutive
// weekly runs (31999694781, 32600311656, 32695529989), 15 days with no live
// artifact validation. A per-run package install on a network-isolated runner
// is the defect; removing the run-time binary dependency is the fix.
//
// FIDELITY. The two schemas are frozen (last modified 2008-03-26 and
// 2009-04-08) and tiny, so they are transcribed here as data rather than
// interpreted at run time. Every facet below is asserted against the vendored
// XSDs by tests/audit/sitemap-schema-drift.test.ts, which re-derives them from
// the .xsd files -- edit an XSD without editing this file and that test fails.
// The XSDs remain the normative source of record; this module is a checked
// transcription of them, not a re-specification.

import {XMLParser} from 'fast-xml-parser'
import {SyntaxValidator} from 'fast-xml-validator'

export const SITEMAP_NS = 'http://www.sitemaps.org/schemas/sitemap/0.9'
/** XSD-defined namespace whose attributes (xsi:type, xsi:schemaLocation, ...) are permitted on any element. */
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance'

/** tLoc / tLocSitemap: xsd:anyURI with minLength 12, maxLength 2048. */
export const LOC_FACETS = Object.freeze({minLength: 12, maxLength: 2048})
/** tChangeFreq: xsd:string restricted to these enumeration values, in XSD declaration order. */
export const CHANGEFREQ_VALUES = Object.freeze(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'])
/** tPriority: xsd:decimal with minInclusive 0.0, maxInclusive 1.0. */
export const PRIORITY_FACETS = Object.freeze({minInclusive: 0.0, maxInclusive: 1.0})

/**
 * The two document profiles. `fields` is the xsd:sequence of the entry
 * complexType, IN SCHEMA ORDER -- order is part of the contract (xsd:sequence,
 * not xsd:all), so `<priority>` before `<loc>` is a violation and xmllint
 * reported it as one.
 */
export const PROFILES = Object.freeze({
  sitemapindex: Object.freeze({
    xsd: 'siteindex-0.9.xsd',
    root: 'sitemapindex',
    entry: 'sitemap',
    entryType: 'tSitemap',
    fields: Object.freeze([
      Object.freeze({name: 'loc', type: 'loc', required: true}),
      Object.freeze({name: 'lastmod', type: 'w3cDateOrDateTime', required: false})
    ])
  }),
  urlset: Object.freeze({
    xsd: 'sitemap-0.9.xsd',
    root: 'urlset',
    entry: 'url',
    entryType: 'tUrl',
    fields: Object.freeze([
      Object.freeze({name: 'loc', type: 'loc', required: true}),
      Object.freeze({name: 'lastmod', type: 'w3cDateOrDateTime', required: false}),
      Object.freeze({name: 'changefreq', type: 'changefreq', required: false}),
      Object.freeze({name: 'priority', type: 'priority', required: false})
    ])
  })
})

const ATTR_PREFIX = '@_'
const TEXT_KEY = '#text'

// xsd:date / xsd:dateTime lexical forms (W3C DATETIME, per the tLastmod
// documentation). Year is 4+ digits, optionally negative; 0000 is outside the
// XSD 1.0 value space and is rejected below.
const DATE_RE = /^(-?(?:[1-9]\d{3,}|0\d{3}))-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/
const DATETIME_RE = /^(-?(?:[1-9]\d{3,}|0\d{3}))-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/
// xsd:decimal: no exponent notation, no NaN/INF -- unlike xsd:double.
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

function daysInMonth(year, month) {
  if (month === 2) {
    // Proleptic Gregorian leap rule. Astronomical year numbering: XSD 1.0 has
    // no year 0, so a negative lexical year -Y maps to the leap cycle of -Y.
    const y = year < 0 ? year + 1 : year
    return (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

function timezoneError(tz) {
  if (tz === undefined || tz === 'Z') {
    return null
  }
  const hours = Number(tz.slice(1, 3))
  const minutes = Number(tz.slice(4, 6))
  // xsd timezone range is -14:00 .. +14:00 inclusive.
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    return `timezone offset "${tz}" is outside the -14:00..+14:00 range`
  }
  return null
}

function calendarError(yearText, monthText, dayText) {
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year === 0) {
    return 'year 0000 is not a valid xsd:date/xsd:dateTime year'
  }
  if (month < 1 || month > 12) {
    return `month ${monthText} is out of range`
  }
  const maxDay = daysInMonth(year, month)
  if (day < 1 || day > maxDay) {
    return `day ${dayText} is out of range for ${yearText}-${monthText} (max ${maxDay})`
  }
  return null
}

/** xsd:date | xsd:dateTime (the tLastmod xsd:union). Returns an error string, or null when valid. */
export function w3cDateOrDateTimeError(value) {
  const asDate = DATE_RE.exec(value)
  if (asDate) {
    return calendarError(asDate[1], asDate[2], asDate[3]) || timezoneError(asDate[4])
  }

  const asDateTime = DATETIME_RE.exec(value)
  if (!asDateTime) {
    return `"${value}" is neither an xsd:date nor an xsd:dateTime (W3C DATETIME format)`
  }
  const calendar = calendarError(asDateTime[1], asDateTime[2], asDateTime[3])
  if (calendar) {
    return calendar
  }
  const [hours, minutes, seconds] = [asDateTime[4], asDateTime[5], asDateTime[6]].map(Number)
  const fraction = asDateTime[7]
  if (hours > 24 || minutes > 59 || seconds > 59) {
    return `time ${asDateTime[4]}:${asDateTime[5]}:${asDateTime[6]} is out of range`
  }
  // 24:00:00 is the only legal use of hour 24 (end-of-day), matching libxml2.
  if (hours === 24 && (minutes !== 0 || seconds !== 0 || (fraction !== undefined && Number(fraction) !== 0))) {
    return 'hour 24 is only valid as exactly 24:00:00'
  }
  return timezoneError(asDateTime[8])
}

/** tLoc / tLocSitemap: xsd:anyURI narrowed by minLength/maxLength. Returns an error string, or null when valid. */
export function locError(value) {
  if (value.length < LOC_FACETS.minLength) {
    return `"${value}" is shorter than the minLength ${LOC_FACETS.minLength} facet (${value.length} characters)`
  }
  if (value.length > LOC_FACETS.maxLength) {
    return `value is longer than the maxLength ${LOC_FACETS.maxLength} facet (${value.length} characters)`
  }
  return null
}

/** tChangeFreq enumeration. Returns an error string, or null when valid. */
export function changefreqError(value) {
  if (!CHANGEFREQ_VALUES.includes(value)) {
    return `"${value}" is not one of the permitted values (${CHANGEFREQ_VALUES.join(', ')})`
  }
  return null
}

/** tPriority: xsd:decimal in [0.0, 1.0]. Returns an error string, or null when valid. */
export function priorityError(value) {
  if (!DECIMAL_RE.test(value)) {
    return `"${value}" is not a valid xsd:decimal`
  }
  const numeric = Number(value)
  if (numeric < PRIORITY_FACETS.minInclusive || numeric > PRIORITY_FACETS.maxInclusive) {
    return `${value} is outside the permitted range ${PRIORITY_FACETS.minInclusive}..${PRIORITY_FACETS.maxInclusive}`
  }
  return null
}

const VALUE_VALIDATORS = {loc: locError, w3cDateOrDateTime: w3cDateOrDateTimeError, changefreq: changefreqError, priority: priorityError}

// preserveOrder keeps the document order this schema's xsd:sequence depends on.
// parseTagValue/parseAttributeValue are off so `<priority>5.0</priority>` stays
// the string "5.0" (coerced to the number 5 it would silently lose the lexical
// form xsd:decimal is defined over).
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true
})

/** The tag name of a preserveOrder node (`:@` holds its attributes, never a tag). */
function tagOf(node) {
  return Object.keys(node).find((key) => key !== ':@')
}

/** Processing instructions (`?xml`) and declarations are not element content. */
function isNonElementNode(tag) {
  return tag === undefined || tag.startsWith('?') || tag.startsWith('!')
}

/** Extend a prefix -> namespace-URI scope with the xmlns declarations on `node`. */
function extendScope(parentScope, node) {
  const attributes = node[':@'] || {}
  let scope = parentScope
  for (const [key, value] of Object.entries(attributes)) {
    const name = key.slice(ATTR_PREFIX.length)
    if (name === 'xmlns') {
      scope = {...scope, '': String(value)}
    } else if (name.startsWith('xmlns:')) {
      scope = {...scope, [name.slice('xmlns:'.length)]: String(value)}
    }
  }
  return scope
}

/** Resolve an element QName against a scope. Unprefixed elements take the default namespace. */
function resolveElement(scope, qname) {
  const colon = qname.indexOf(':')
  if (colon === -1) {
    return {ns: scope[''] || '', local: qname}
  }
  const prefix = qname.slice(0, colon)
  return {ns: Object.hasOwn(scope, prefix) ? scope[prefix] : null, local: qname.slice(colon + 1)}
}

/** Concatenated text directly inside an element (`<loc>` content, or stray characters in a container). */
function textOf(node, tag) {
  return node[tag].filter((child) => Object.hasOwn(child, TEXT_KEY)).map((child) => String(child[TEXT_KEY])).join('')
}

/** Element children of a node, paired with their resolved names. Non-element nodes are dropped. */
function elementChildren(node, tag, scope) {
  const children = []
  for (const child of node[tag]) {
    const childTag = tagOf(child)
    if (childTag === TEXT_KEY || isNonElementNode(childTag)) {
      continue
    }
    const childScope = extendScope(scope, child)
    children.push({node: child, tag: childTag, scope: childScope, ...resolveElement(childScope, childTag)})
  }
  return children
}

/**
 * Both schemas admit foreign-namespace elements only through
 * `xsd:any namespace="##other" processContents="strict"`. STRICT means the
 * processor must find a global declaration for the element and validate
 * against it -- so with only these two schemas loaded (exactly what
 * `xmllint --schema <one xsd>` did in production) every foreign-namespace
 * element is a violation, wherever it appears. Verified against libxml
 * 20913: both `<x:e xmlns:x="urn:x"/>` and the common i18n
 * `<xhtml:link rel="alternate"/>` are rejected with "No matching global
 * element declaration available, but demanded by the strict wildcard."
 */
function foreignElementError(child, path) {
  if (child.ns === null) {
    return `${path}: prefix "${child.tag.split(':')[0]}" is not bound to any namespace`
  }
  return `${path}: element {${child.ns}}${child.local} has no matching global declaration, but is demanded by the strict ##other wildcard`
}

/**
 * The entry complexTypes declare no attributes, so anything other than a
 * namespace declaration or an xsi:* attribute is a violation.
 */
function attributeErrors(node, scope, path) {
  const errors = []
  for (const key of Object.keys(node[':@'] || {})) {
    const name = key.slice(ATTR_PREFIX.length)
    if (name === 'xmlns' || name.startsWith('xmlns:')) {
      continue
    }
    const colon = name.indexOf(':')
    if (colon !== -1 && scope[name.slice(0, colon)] === XSI_NS) {
      continue
    }
    errors.push(`${path}: undeclared attribute "${name}" (the schema declares no attributes on this element)`)
  }
  return errors
}

/** Validate one <url>/<sitemap> entry against its complexType's xsd:sequence. */
function validateEntry(entryNode, entryTag, scope, profile, path) {
  const errors = attributeErrors(entryNode, scope, path)

  const stray = textOf(entryNode, entryTag).trim()
  if (stray !== '') {
    errors.push(`${path}: character content "${stray}" is not allowed (the complexType is not mixed)`)
  }

  const children = elementChildren(entryNode, entryTag, scope)
  const seen = new Map()
  // Cursor into profile.fields: the xsd:sequence forbids going backwards.
  let cursor = 0

  for (const child of children) {
    const childPath = `${path}/${child.tag}`
    if (child.ns !== SITEMAP_NS) {
      errors.push(foreignElementError(child, childPath))
      continue
    }

    const index = profile.fields.findIndex((field) => field.name === child.local)
    if (index === -1) {
      errors.push(`${childPath}: <${child.local}> is not a permitted child of <${profile.entry}>`)
      continue
    }
    if (seen.has(child.local)) {
      errors.push(`${childPath}: <${child.local}> occurs more than once (maxOccurs is 1)`)
      continue
    }
    if (index < cursor) {
      errors.push(`${childPath}: <${child.local}> is out of xsd:sequence order (expected ${profile.fields.map((f) => f.name).join(', ')})`)
    }
    cursor = Math.max(cursor, index)
    seen.set(child.local, child)

    const grandchildren = elementChildren(child.node, child.tag, child.scope)
    if (grandchildren.length > 0) {
      errors.push(`${childPath}: contains child elements, but its type is a simpleType`)
      continue
    }
    errors.push(...attributeErrors(child.node, child.scope, childPath))
    const value = textOf(child.node, child.tag).trim()
    const valueError = VALUE_VALIDATORS[profile.fields[index].type](value)
    if (valueError) {
      errors.push(`${childPath}: ${valueError}`)
    }
  }

  for (const field of profile.fields) {
    if (field.required && !seen.has(field.name)) {
      errors.push(`${path}: missing required <${field.name}>`)
    }
  }

  return errors
}

/**
 * Validate a sitemap document against the vendored sitemaps.org 0.9 schema for
 * `profileName` ('urlset' or 'sitemapindex'). Returns an array of violation
 * messages -- empty means valid. Never throws: malformed XML comes back as a
 * violation, matching the return-a-finding contract the audit scripts rely on.
 */
export function validateSitemapDocument(xml, profileName) {
  const profile = PROFILES[profileName]
  if (!profile) {
    throw new Error(`unknown sitemap profile "${profileName}"`)
  }

  // XMLParser.parse() is lenient by design and recovers from mismatched tags;
  // SyntaxValidator is the strict well-formedness gate (see check-feeds.mjs).
  // It returns true on success and THROWS a ValidationError on malformed XML.
  try {
    SyntaxValidator.validate(xml)
  } catch (err) {
    return [`not well-formed XML (${err.code} at line ${err.line}): ${err.message}`]
  }

  const document = parser.parse(xml)
  const roots = document.filter((node) => !isNonElementNode(tagOf(node)) && tagOf(node) !== TEXT_KEY)
  if (roots.length !== 1) {
    return [`expected exactly one root element, found ${roots.length}`]
  }

  const rootNode = roots[0]
  const rootTag = tagOf(rootNode)
  const rootScope = extendScope({}, rootNode)
  const root = resolveElement(rootScope, rootTag)
  if (root.local !== profile.root || root.ns !== SITEMAP_NS) {
    return [`root element is {${root.ns || 'no namespace'}}${root.local}, expected {${SITEMAP_NS}}${profile.root}`]
  }

  const errors = attributeErrors(rootNode, rootScope, `/${profile.root}`)

  const stray = textOf(rootNode, rootTag).trim()
  if (stray !== '') {
    errors.push(`/${profile.root}: character content "${stray}" is not allowed (the complexType is not mixed)`)
  }

  const children = elementChildren(rootNode, rootTag, rootScope)
  let entryCount = 0
  for (const child of children) {
    const childPath = `/${profile.root}/${child.tag}[${entryCount + 1}]`
    if (child.ns !== SITEMAP_NS) {
      errors.push(foreignElementError(child, `/${profile.root}/${child.tag}`))
      continue
    }
    if (child.local !== profile.entry) {
      errors.push(`/${profile.root}/${child.tag}: <${child.local}> is not a permitted child of <${profile.root}>`)
      continue
    }
    entryCount += 1
    errors.push(...validateEntry(child.node, child.tag, child.scope, profile, childPath))
  }

  if (entryCount === 0) {
    errors.push(`/${profile.root}: contains no <${profile.entry}> elements (minOccurs is 1)`)
  }

  return errors
}
