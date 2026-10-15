import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {findClearEmails} from '../../scripts/check-no-clear-email.mjs'
import {decodeEmail, encodeEmail, splitEmails} from '../../src/lib/email/obfuscate'

// Build-time email obfuscation (atlas decision 0158; on Workers since decision 0160 the zone feature
// no longer rewrites the HTML).

const ADDRESS = 'webmaster@lifegames.org'

describe('encodeEmail and decodeEmail', () => {
  it('round-trips, and the encoded form never contains the address or an @', () => {
    const encoded = encodeEmail(ADDRESS)
    expect(decodeEmail(encoded)).toBe(ADDRESS)
    expect(encoded).toMatch(/^[0-9a-f]+$/)
    expect(encoded).not.toContain('@')
    expect(encoded.length).toBe(2 + ADDRESS.length * 2)
  })

  it('is deterministic, so builds are reproducible, and its key is never zero', () => {
    expect(encodeEmail(ADDRESS)).toBe(encodeEmail(ADDRESS))
    expect(encodeEmail(ADDRESS).slice(0, 2)).not.toBe('00')
  })

  it('refuses a non-ASCII or malformed address', () => {
    expect(() => encodeEmail('josé@example.com')).toThrow(/printable ASCII/)
    expect(() => encodeEmail('not-an-address')).toThrow()
  })
})

describe('splitEmails', () => {
  it('keeps the text and encodes each address in place', () => {
    const segments = splitEmails(`Write to ${ADDRESS} or ${ADDRESS}.`)
    expect(segments.map((s) => s.kind)).toEqual(['text', 'email', 'text', 'email', 'text'])
    expect(segments[0]).toEqual({kind: 'text', text: 'Write to '})
    expect(segments[4]).toEqual({kind: 'text', text: '.'})
  })

  it('returns the text unchanged when it names no address', () => {
    expect(splitEmails('No address here.')).toEqual([{kind: 'text', text: 'No address here.'}])
  })
})

describe('public/js/email-decode.js (the shipped ES2017 decoder)', () => {
  it('turns an encoded link into a mailto link with the address as its text', () => {
    document.body.innerHTML = `<p>Mail <a href="/contact" data-email="${encodeEmail(ADDRESS)}">Contact</a>.</p>`
    // The page script, exactly as the site serves it.
    new Function(readFileSync(resolve(process.cwd(), 'public/js/email-decode.js'), 'utf8'))()
    const link = document.querySelector('a')
    expect(link?.getAttribute('href')).toBe(`mailto:${ADDRESS}`)
    expect(link?.textContent).toBe(ADDRESS)
    expect(link?.hasAttribute('data-email')).toBe(false)
  })

  it('leaves a link alone when the decoded value is not an address', () => {
    document.body.innerHTML = '<a href="/contact" data-email="2a4b4c">Contact</a>'
    new Function(readFileSync(resolve(process.cwd(), 'public/js/email-decode.js'), 'utf8'))()
    expect(document.querySelector('a')?.getAttribute('href')).toBe('/contact')
  })
})

describe('findClearEmails (the postbuild gate)', () => {
  it('finds an address in text and a mailto in an attribute', () => {
    expect(findClearEmails(`<p>Write to ${ADDRESS}.</p>\n<a href="mailto:x">x</a>`)).toEqual([`1: ${ADDRESS}`, '2: mailto:'])
  })

  it('passes the encoded markup', () => {
    expect(findClearEmails(`<a class="email-link" href="/contact" data-email="${encodeEmail(ADDRESS)}">Contact</a>`)).toEqual([])
  })
})
