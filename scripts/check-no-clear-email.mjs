#!/usr/bin/env node
/* Postbuild gate: no built HTML carries an email address in clear (atlas decision 0158: email
 * obfuscation stays; decision 0160: on Workers, Cloudflare's zone Email Address Obfuscation no longer
 * rewrites the site's HTML, so the build does it, src/lib/email/).
 *
 * Scans every dist/client/**\/*.html for an address or a mailto: link, in text and in attributes, and
 * fails with file:line. One exception: the JSON-LD block may name the organization's contact alias
 * (copy identity.organization.contactEmail; owner rulings 2026-10-24). That alias is a purpose-made,
 * revocable address, published so the Organization and Person nodes carry a contact email. Any other
 * address, and any mailto:, fails there too, and the alias fails outside the JSON-LD block.
 * Non-HTML outputs are out of scope on purpose: /.well-known/security.txt must keep its clear
 * Contact line (RFC 9116), and text and Markdown were never obfuscated. */
import {readdirSync, readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'
import {parse} from 'parse5'
import {clientDir} from './lib/build-paths.mjs'

// The @ also matches its HTML character references and its JSON escape, so an encoded form of an
// address is not a way past the gate. Each form keeps its source offset.
const AT = String.raw`(?:@|&#0*64;|&#x0*40;|&commat;|\\u0040)`
const ADDRESS = new RegExp(String.raw`[A-Za-z0-9._%+-]+${AT}[A-Za-z0-9.-]+\.[A-Za-z]{2,}`, 'gi')
const AT_FORMS = new RegExp(AT, 'gi')
const MAILTO = /mailto:/gi
const JSON_LD_TYPE = 'application/ld+json'

const copy = createRequire(import.meta.url)('@j0nathan-ll0yd/copy/identity.flat.json')
const alias = copy.organization.contactEmail
if (typeof alias !== 'string' || !alias.includes('@') || alias === copy.person.email) {
  throw new Error('[check-no-clear-email] copy organization.contactEmail must be an address distinct from person.email')
}

/** The one address the JSON-LD block may name: the organization's contact alias. */
export const JSON_LD_ALLOWED_ADDRESSES = Object.freeze([alias])

/**
 * The source spans of every <script type="application/ld+json"> body, from parse5's source locations,
 * so a comment or a string that only looks like the tag opens no span.
 */
function jsonLdSpans(html) {
  const spans = []
  const walk = (node) => {
    if (
      node.nodeName === 'script' && node.attrs?.some((attr) => attr.name === 'type' && attr.value.trim().toLowerCase() === JSON_LD_TYPE) &&
      node.sourceCodeLocation?.startTag && node.sourceCodeLocation.endTag
    ) {
      spans.push([node.sourceCodeLocation.startTag.endOffset, node.sourceCodeLocation.endTag.startOffset])
    }
    for (const child of node.childNodes ?? []) {
      walk(child)
    }
    if (node.content) {
      walk(node.content)
    }
  }
  walk(parse(html, {sourceCodeLocationInfo: true}))
  return spans
}

/** Every clear address or mailto: in one HTML document, as `line: match`. */
export function findClearEmails(html, {jsonLdAllowed = JSON_LD_ALLOWED_ADDRESSES} = {}) {
  const spans = jsonLdSpans(html)
  const inJsonLd = (start, end) => spans.some(([spanStart, spanEnd]) => start >= spanStart && end <= spanEnd)
  const lineOf = (offset) => html.slice(0, offset).split('\n').length
  const findings = []
  for (const match of html.matchAll(ADDRESS)) {
    const address = match[0].replace(AT_FORMS, '@')
    if (!(jsonLdAllowed.includes(address) && inJsonLd(match.index, match.index + match[0].length))) {
      findings.push({offset: match.index, text: `${lineOf(match.index)}: ${match[0]}`})
    }
  }
  for (const match of html.matchAll(MAILTO)) {
    findings.push({offset: match.index, text: `${lineOf(match.index)}: mailto:`})
  }
  return findings.sort((a, b) => a.offset - b.offset).map((finding) => finding.text)
}

function main() {
  const root = clientDir()
  const files = readdirSync(root, {recursive: true, withFileTypes: true}).filter((entry) => entry.isFile() && entry.name.endsWith('.html')).map((entry) =>
    path.join(entry.parentPath, entry.name)
  )
  const failures = []
  for (const file of files) {
    for (const finding of findClearEmails(readFileSync(file, 'utf8'))) {
      failures.push(`${path.relative(process.cwd(), file)}:${finding}`)
    }
  }
  if (failures.length > 0) {
    console.error('[check-no-clear-email] built HTML carries an email address in clear (render it with src/lib/email/ObfuscatedText.astro):')
    for (const failure of failures) {
      console.error(`  ${failure}`)
    }
    process.exit(1)
  }
  console.log(`[check-no-clear-email] OK: no clear email address in ${files.length} HTML file(s), outside the organization alias in JSON-LD`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
