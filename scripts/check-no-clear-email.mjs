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
import {clientDir} from './lib/build-paths.mjs'

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const MAILTO = /mailto:/gi
const JSON_LD_BLOCK = /<script type="application\/ld\+json">[\s\S]*?<\/script>/gi

/** The one address the JSON-LD block may name: the organization's contact alias. */
export const JSON_LD_ALLOWED_ADDRESSES = Object.freeze([
  createRequire(import.meta.url)('@j0nathan-ll0yd/copy/identity.flat.json').organization.contactEmail
])

/** Every clear address or mailto: in one HTML document, as `line: match`. */
export function findClearEmails(html, {jsonLdAllowed = JSON_LD_ALLOWED_ADDRESSES} = {}) {
  const jsonLdSpans = [...html.matchAll(JSON_LD_BLOCK)].map((m) => [m.index, m.index + m[0].length])
  const inJsonLd = (offset) => jsonLdSpans.some(([start, end]) => offset >= start && offset < end)
  const lineOf = (offset) => html.slice(0, offset).split('\n').length
  const findings = []
  for (const match of html.matchAll(ADDRESS)) {
    if (!(jsonLdAllowed.includes(match[0]) && inJsonLd(match.index))) {
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
  console.log(`[check-no-clear-email] OK: no clear email address in ${files.length} HTML file(s)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
