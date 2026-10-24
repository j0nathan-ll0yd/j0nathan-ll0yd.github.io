import {beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'fs'
import {load} from 'cheerio'
import path from 'path'
import {DATASET_DISTRIBUTIONS, DATASET_VARIABLES, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {clientDir} from '../../scripts/lib/build-paths.mjs'
import {identity} from '@j0nathan-ll0yd/copy'

const distDir = clientDir()

/** Parse the single JSON-LD @graph emitted by a built HTML page. */
function loadGraph(relPath: string): any[] {
  const html = readFileSync(path.join(distDir, relPath), 'utf-8')
  const $ = load(html)
  const scriptContent = $('script[type="application/ld+json"]').html()
  expect(scriptContent, `${relPath} must emit a JSON-LD block`).toBeTruthy()
  const parsed = JSON.parse(scriptContent!)
  return parsed['@graph']
}

/**
 * Collect every `@id` that some node in the graph DEFINES (a node object that
 * carries both `@type` and `@id`) and every `@id` that is REFERENCED (any nested
 * object whose only meaningful key is `@id`, e.g. `mainEntity`, `publisher`,
 * `isPartOf`, `creator`). A reference is dangling if it names an `@id` no node
 * defines on the same page.
 */
function collectIds(graph: any[]): {defined: Set<string>; referenced: Set<string>} {
  const defined = new Set<string>()
  const referenced = new Set<string>()
  const walk = (value: any, isTopLevelNode: boolean) => {
    if (Array.isArray(value)) {
      value.forEach((v) => walk(v, false))
      return
    }
    if (!value || typeof value !== 'object') {
      return
    }
    if (typeof value['@id'] === 'string') {
      if (isTopLevelNode && value['@type']) {
        defined.add(value['@id'])
      } else {
        // A bare `{ "@id": ... }` (no `@type`) is a cross-reference to another node.
        referenced.add(value['@id'])
      }
    }
    for (const [key, v] of Object.entries(value)) {
      if (key === '@id' || key === '@type') {
        continue
      }
      walk(v, false)
    }
  }
  graph.forEach((node) => walk(node, true))
  return {defined, referenced}
}

let graph: any[]

beforeAll(() => {
  graph = loadGraph('index.html')
})

describe('JSON-LD Structured Data', () => {
  it('parses as valid JSON', () => {
    expect(graph).toBeDefined()
    expect(Array.isArray(graph)).toBe(true)
  })

  it('contains a WebSite node', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite')
    expect(website).toBeDefined()
  })

  it('WebSite has correct url', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite')
    expect(website.url).toBe(SITE_URL)
  })

  it('WebSite has name', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite')
    expect(website.name).toBeTruthy()
    expect(website.name).toContain('Jonathan Lloyd')
  })

  it('contains a Person node', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person).toBeDefined()
  })

  it('Person has name "Jonathan Lloyd"', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.name).toBe('Jonathan Lloyd')
  })

  it('Person has jobTitle', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.jobTitle).toBeTruthy()
  })

  it('Person has description', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.description).toBeTruthy()
    expect(person.description.length).toBeGreaterThan(0)
  })

  it('Person has knowsAbout array', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(Array.isArray(person.knowsAbout)).toBe(true)
    expect(person.knowsAbout.length).toBeGreaterThan(0)
  })

  it('Person has sameAs array with social links', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(Array.isArray(person.sameAs)).toBe(true)
    expect(person.sameAs.length).toBeGreaterThan(0)
  })

  // Guards against a silently-dropped @j0nathan-ll0yd/copy field: worksFor/alumniOf are
  // assembled from identity.person.employer* / alumniOf*, and JSON.stringify omits
  // undefined, so a missing copy field would vanish with no other test noticing.
  // Structural (not value-pinned) so it survives an employer/school change.
  it('Person has worksFor (Organization) with a name and url', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.worksFor, 'Person.worksFor missing (copy field dropped?)').toBeDefined()
    expect(person.worksFor['@type']).toBe('Organization')
    expect(person.worksFor.name).toBeTruthy()
    expect(person.worksFor.url).toMatch(/^https?:\/\//)
  })

  it('Person has alumniOf (EducationalOrganization) with a name and url', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.alumniOf, 'Person.alumniOf missing (copy field dropped?)').toBeDefined()
    expect(person.alumniOf['@type']).toBe('EducationalOrganization')
    expect(person.alumniOf.name).toBeTruthy()
    expect(person.alumniOf.url).toMatch(/^https?:\/\//)
  })

  it('all urls use the canonical site URL', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite')
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(website.url).toMatch(SITE_URL)
    expect(person.url).toMatch(SITE_URL)
  })
})

describe('JSON-LD Dataset (sourced from @j0nathan-ll0yd/portal-contract)', () => {
  it('contains a Dataset node', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset')
    expect(dataset).toBeDefined()
  })

  it('variableMeasured equals DATASET_VARIABLES exactly (ordered)', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset')
    expect(dataset.variableMeasured).toEqual([...DATASET_VARIABLES])
  })

  it('distribution equals DATASET_DISTRIBUTIONS exactly (ordered, DataDownload shape)', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset')
    const expected = DATASET_DISTRIBUTIONS.map((d) => ({'@type': 'DataDownload', name: d.name, encodingFormat: d.encodingFormat, contentUrl: d.contentUrl}))
    expect(dataset.distribution).toEqual(expected)
  })

  it('license points at the privacy page, not the bare site root', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset')
    expect(dataset.license).toBe(SITE_URL + '/privacy')
  })

  it('publisher points at the organization', () => {
    const dataset = graph.find((n: any) => n['@type'] === 'Dataset')
    expect(dataset.publisher).toEqual({'@id': ORGANIZATION_ID})
  })
})

// Owner rulings 2026-10-24 (reversing atlas decision 0158 O5): a Lifegames Organization with the
// contact alias and the PO Box, first in the graph. Every value is a copy key. The alias is a
// purpose-made address; the personal address (identity.person.email) appears in no page.
const ORGANIZATION_ID = SITE_URL + '#organization'
const PERSON_ID = SITE_URL + '#person'
const PO_BOX_ADDRESS = {
  '@type': 'PostalAddress',
  postOfficeBoxNumber: identity.organization.poBox,
  addressLocality: identity.organization.locality,
  addressRegion: identity.organization.region,
  postalCode: identity.organization.postalCode,
  addressCountry: identity.organization.country
}

describe('JSON-LD Organization (sourced from @j0nathan-ll0yd/copy)', () => {
  // covers: dashboard-shell#The structured data names the organization first, with a contact alias and a PO Box
  it('is the first graph node', () => {
    expect(graph[0]['@type']).toBe('Organization')
    expect(graph[0]['@id']).toBe(ORGANIZATION_ID)
  })

  it('names Lifegames from copy, at the site URL, with its NAICS code and description', () => {
    const organization = graph[0]
    expect(organization.name).toBe(identity.organization.name)
    expect(organization.url).toBe(SITE_URL)
    expect(organization.description).toBe(identity.organization.description)
    expect(organization.naics).toBe('541511')
  })

  it('carries the site icon as an ImageObject logo', () => {
    expect(graph[0].logo).toEqual({'@type': 'ImageObject', url: SITE_URL + '/assets/icon-512.png', width: 512, height: 512})
  })

  it('names the Person as founder and member, and shares its profile links', () => {
    const organization = graph[0]
    expect(organization.founder).toEqual({'@id': PERSON_ID})
    expect(organization.member).toEqual({'@id': PERSON_ID})
    expect(organization.sameAs).toEqual(identity.person.sameAs)
  })

  it('carries the alias at the top level and in a contactPoint with the copy contact type', () => {
    const organization = graph[0]
    expect(organization.email).toBe(identity.organization.contactEmail)
    expect(organization.contactPoint).toEqual([
      {
        '@type': 'ContactPoint',
        contactType: identity.organization.contactType,
        email: identity.organization.contactEmail,
        url: SITE_URL + '/contact',
        availableLanguage: 'en'
      }
    ])
    expect(organization.contactPoint[0].email).toBeTruthy()
    expect(organization.contactPoint[0].contactType).toBeTruthy()
  })

  it('carries the PO Box PostalAddress with no street address', () => {
    const organization = graph[0]
    expect(organization.address).toEqual(PO_BOX_ADDRESS)
    expect(organization.address.postOfficeBoxNumber).toBeTruthy()
    expect(organization.address.postalCode).toBeTruthy()
    expect(organization.address).not.toHaveProperty('streetAddress')
  })

  it('is the WebSite publisher', () => {
    const website = graph.find((n: any) => n['@type'] === 'WebSite')
    expect(website.publisher['@id']).toBe(ORGANIZATION_ID)
  })

  it('is the Person memberOf', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.memberOf['@id']).toBe(ORGANIZATION_ID)
  })

  it('Person contactPoint carries the copy contact type, the /contact page, and the organization alias', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.contactPoint).toEqual({
      '@type': 'ContactPoint',
      contactType: identity.person.contactType,
      email: identity.organization.contactEmail,
      url: SITE_URL + '/contact'
    })
    expect(person.contactPoint.email).toBe(graph[0].email)
  })

  it('Person address is the same PO Box PostalAddress', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.address).toEqual(PO_BOX_ADDRESS)
    expect(person.address.postOfficeBoxNumber).toBeTruthy()
  })

  it('never names the personal address', () => {
    expect(identity.organization.contactEmail).not.toBe(identity.person.email)
    expect(JSON.stringify(graph)).not.toContain(identity.person.email)
  })

  it('leaves the employer and university nodes nested and typed (round 1)', () => {
    const person = graph.find((n: any) => n['@type'] === 'Person')
    expect(person.worksFor['@type']).toBe('Organization')
    expect(person.worksFor.name).toBe(identity.person.employer)
    expect(person.alumniOf['@type']).toBe('EducationalOrganization')
    expect(person.alumniOf.name).toBe(identity.person.alumniOf)
    expect(graph.filter((n: any) => n['@type'] === 'Organization').map((n: any) => n['@id'])).toEqual([ORGANIZATION_ID])
  })
})

// Regression guard for the /privacy + /404 bug: Dashboard.astro is the shared
// layout for every page, and it once emitted ProfilePage + Dataset on all of
// them (labelling the privacy policy as a person's profile page). These assert
// the per-page @graph is internally consistent and that person-scoped nodes are
// gated to the home page.
describe('JSON-LD @graph per-page shape and @id resolution', () => {
  const pages = [
    {label: 'home', file: 'index.html', isHome: true, webPageType: null},
    {label: 'privacy', file: 'privacy.html', isHome: false, webPageType: 'WebPage'},
    {label: 'about', file: 'about.html', isHome: false, webPageType: 'AboutPage'},
    {label: 'contact', file: 'contact.html', isHome: false, webPageType: 'ContactPage'},
    {label: 'developers', file: 'developers.html', isHome: false, webPageType: 'WebPage'},
    {label: '404', file: '404.html', isHome: false, webPageType: 'WebPage'}
  ]

  for (const page of pages) {
    describe(`${page.label} (${page.file})`, () => {
      let pageGraph: any[]
      beforeAll(() => {
        pageGraph = loadGraph(page.file)
      })

      it('parses as a non-empty JSON @graph array', () => {
        expect(Array.isArray(pageGraph)).toBe(true)
        expect(pageGraph.length).toBeGreaterThan(0)
      })

      it('has no dangling @id references (every reference resolves to a defined node)', () => {
        const {defined, referenced} = collectIds(pageGraph)
        const dangling = [...referenced].filter((id) => !defined.has(id))
        expect(dangling, `dangling @id references on ${page.file}`).toEqual([])
      })

      it('always carries a WebSite and a Person node', () => {
        expect(pageGraph.some((n) => n['@type'] === 'WebSite')).toBe(true)
        expect(pageGraph.some((n) => n['@type'] === 'Person')).toBe(true)
      })

      it('opens with the Organization node', () => {
        expect(pageGraph[0]['@type']).toBe('Organization')
        expect(pageGraph[0]['@id']).toBe(ORGANIZATION_ID)
      })

      if (page.isHome) {
        it('home page defines ProfilePage and Dataset', () => {
          expect(pageGraph.some((n) => n['@type'] === 'ProfilePage')).toBe(true)
          expect(pageGraph.some((n) => n['@type'] === 'Dataset')).toBe(true)
        })

        it('ProfilePage carries no dateModified (no verifiable profile edit date exists)', () => {
          const profilePage = pageGraph.find((n) => n['@type'] === 'ProfilePage')
          expect(profilePage).not.toHaveProperty('dateModified')
        })

        it('home page does NOT emit a WebPage node', () => {
          expect(pageGraph.some((n) => n['@type'] === 'WebPage')).toBe(false)
        })
      } else {
        it('non-home page does NOT emit ProfilePage or Dataset', () => {
          expect(pageGraph.some((n) => n['@type'] === 'ProfilePage')).toBe(false)
          expect(pageGraph.some((n) => n['@type'] === 'Dataset')).toBe(false)
        })

        it(`non-home page emits a ${page.webPageType} node that isPartOf the WebSite`, () => {
          const webpage = pageGraph.find((n) => n['@type'] === page.webPageType)
          expect(webpage).toBeDefined()
          expect(webpage.isPartOf['@id']).toBe(SITE_URL + '#website')
          expect(webpage.name).toBeTruthy()
        })
      }
    })
  }
})
