#!/usr/bin/env node
/* Postbuild gate: no built HTML carries an email address in clear (atlas decision 0158: email
 * obfuscation stays; decision 0160: on Workers, Cloudflare's zone Email Address Obfuscation no longer
 * rewrites the site's HTML, so the build does it, src/lib/email/).
 *
 * Scans every dist/client/**\/*.html for an address or a mailto: link, in text and in attributes, and
 * fails with file:line. Non-HTML outputs are out of scope on purpose: /.well-known/security.txt must
 * keep its clear Contact line (RFC 9116), and text and Markdown were never obfuscated. */
import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {clientDir} from './lib/build-paths.mjs'

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
const MAILTO = /mailto:/i

/** Every clear address or mailto: in one HTML document, as `line: match`. */
export function findClearEmails(html) {
  const findings = []
  html.split('\n').forEach((line, index) => {
    const address = line.match(ADDRESS)
    if (address) {
      findings.push(`${index + 1}: ${address[0]}`)
    }
    if (MAILTO.test(line)) {
      findings.push(`${index + 1}: mailto:`)
    }
  })
  return findings
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
