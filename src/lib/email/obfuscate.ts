// Build-time email obfuscation (atlas decision 0158: obfuscation stays; decision 0160 moved the site
// to a Worker, where Cloudflare's zone Email Address Obfuscation no longer rewrites the HTML).
//
// The HTML never carries an address in clear. Each address becomes an XOR-encoded hex string in a
// `data-email` attribute, in the style of Cloudflare's `data-cfemail`: the first byte is the key and
// every later byte is one character XOR the key. public/js/email-decode.js turns it back into a
// mailto link in the browser. This module is the one encoder; ObfuscatedText.astro renders it, and
// scripts/check-no-clear-email.mjs fails the build if any built HTML still carries an address (the
// organization alias inside the JSON-LD block excepted).

import {createHash} from 'node:crypto'
import {SITE_PAGE_PATHS} from '../edge/site-paths'

/** An email address, as the build gate and the splitter find it. */
export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Where an obfuscated link goes without JavaScript: the contact page (decision 0158 W2). */
export const EMAIL_FALLBACK_PATH = SITE_PAGE_PATHS.contact

/** The decoder the page loads once (CSP script-src 'self'; ES2017 floor). */
export const EMAIL_DECODE_SCRIPT = '/js/email-decode.js'

/**
 * The XOR key for an address: derived from its SHA-256, so a build is reproducible, and never zero
 * (a zero key would leave the address readable in hex).
 */
function keyFor(email: string): number {
  const byte = createHash('sha256').update(email).digest()[0] ?? 1
  return byte === 0 ? 0x5a : byte
}

const hex = (value: number): string => value.toString(16).padStart(2, '0')

/** The `data-email` value for one ASCII address. */
export function encodeEmail(email: string): string {
  if (!/^[\x21-\x7e]+$/.test(email) || !email.includes('@')) {
    throw new Error(`encodeEmail: not a printable ASCII address: ${JSON.stringify(email)}`)
  }
  const key = keyFor(email)
  return hex(key) + [...email].map((char) => hex(char.charCodeAt(0) ^ key)).join('')
}

/** The inverse of encodeEmail. public/js/email-decode.js implements the same steps in ES2017. */
export function decodeEmail(encoded: string): string {
  const key = Number.parseInt(encoded.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < encoded.length; i += 2) {
    out += String.fromCharCode(Number.parseInt(encoded.slice(i, i + 2), 16) ^ key)
  }
  return out
}

export type TextSegment = {kind: 'text'; text: string} | {kind: 'email'; encoded: string}

/** Splits text into plain runs and encoded addresses, in order. */
export function splitEmails(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    const start = match.index ?? 0
    if (start > last) {
      segments.push({kind: 'text', text: text.slice(last, start)})
    }
    segments.push({kind: 'email', encoded: encodeEmail(match[0])})
    last = start + match[0].length
  }
  if (last < text.length) {
    segments.push({kind: 'text', text: text.slice(last)})
  }
  return segments
}
