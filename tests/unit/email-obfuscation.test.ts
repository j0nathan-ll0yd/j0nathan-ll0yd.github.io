import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {findClearEmails, JSON_LD_ALLOWED_ADDRESSES} from '../../scripts/check-no-clear-email.mjs'
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
  // Owner rulings 2026-10-24: the JSON-LD block may name the organization's contact alias, and
  // nothing else may.
  const ALIAS = 'alias@example.net'
  const jsonLd = (body: string) => `<script type="application/ld+json">${body}</script>`

  // covers: dashboard-shell#The structured data names the organization first, with a contact alias and a PO Box
  it('admits the allowed alias inside the JSON-LD block', () => {
    expect(findClearEmails(jsonLd(`{"email":"${ALIAS}"}`), {jsonLdAllowed: [ALIAS]})).toEqual([])
  })

  it('finds the alias outside the JSON-LD block', () => {
    expect(findClearEmails(`${jsonLd('{}')}\n<p>${ALIAS}</p>`, {jsonLdAllowed: [ALIAS]})).toEqual([`2: ${ALIAS}`])
  })

  it('finds any other address, and a mailto, inside the JSON-LD block', () => {
    expect(findClearEmails(jsonLd(`{"a":"${ALIAS}","b":"${ADDRESS}","c":"mailto:${ALIAS}"}`), {jsonLdAllowed: [ALIAS]})).toEqual([
      `1: ${ADDRESS}`,
      '1: mailto:'
    ])
  })

  it('opens no JSON-LD span from a comment or a script string that only looks like the tag', () => {
    expect(findClearEmails(`<!-- <script type="application/ld+json"> --><p>${ALIAS}</p><!-- </script> -->`, {jsonLdAllowed: [ALIAS]})).toEqual([
      `1: ${ALIAS}`
    ])
    expect(
      findClearEmails(`<script type="module">const tag = '<script type="application/ld+json">'; const a = '${ALIAS}'</script>`, {jsonLdAllowed: [ALIAS]})
    ).toEqual([
      `1: ${ALIAS}`
    ])
  })

  it('finds an address whose @ is a character reference or a JSON escape', () => {
    expect(findClearEmails('<p>me&#64;example.com and you&#x40;example.com</p>\n<p>them&commat;example.com</p>')).toEqual([
      '1: me&#64;example.com',
      '1: you&#x40;example.com',
      '2: them&commat;example.com'
    ])
    expect(findClearEmails(jsonLd('{"email":"me\\u0040example.com"}'))).toEqual(['1: me\\u0040example.com'])
  })

  it('admits by default exactly the copy organization alias, which is not the personal address', () => {
    const copy = createRequire(import.meta.url)('@j0nathan-ll0yd/copy/identity.flat.json')
    expect(JSON_LD_ALLOWED_ADDRESSES).toEqual([copy.organization.contactEmail])
    expect(JSON_LD_ALLOWED_ADDRESSES).not.toContain(copy.person.email)
  })
})
