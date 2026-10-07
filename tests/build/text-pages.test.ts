import {readFileSync} from 'fs'
import path from 'path'
import {type CheerioAPI, load} from 'cheerio'
import {describe, expect, it} from 'vitest'
import {identity, llm} from '@j0nathan-ll0yd/copy'
import {LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {CONTENT_USAGE} from '../../functions/_middleware'
import {AGENT_PATHS, DATA_SOURCES, TOOLS} from '../../functions/_lib/agent-catalog.mjs'
import {FEED_ARTIFACTS} from '../../functions/_lib/feed-artifacts'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts'

// Behavioral, non-screenshot assertions for the copy-driven text pages (atlas decision
// 0158): /about, /contact, and /developers are indexable, carry at least 500 characters
// of visible text (the is-agentic trust-anchor floor), render every copy section, and
// link only what the site serves. /privacy shares their layout and stays noindex.
const distDir = path.resolve(process.cwd(), 'dist')

function page(file: string): CheerioAPI {
  return load(readFileSync(path.join(distDir, file), 'utf-8'))
}

/** The text a reader sees in <main>: scripts and styles removed, whitespace collapsed. */
function visibleText($: CheerioAPI): string {
  const main = $('main').clone()
  main.find('script, style, noscript').remove()
  return main.text().replace(/\s+/g, ' ').trim()
}

const TEXT_PAGES = [
  {file: 'about.html', path: '/about', title: identity.about.title},
  {file: 'contact.html', path: '/contact', title: identity.contact.title},
  {file: 'developers.html', path: AGENT_PATHS.developers, title: llm.developers.title}
]

describe.each(TEXT_PAGES)('$path', ({file, path: pagePath, title}) => {
  const $ = page(file)

  it('is indexable with a canonical URL on the site', () => {
    expect($('meta[name="robots"]').attr('content')).toBe('index, follow')
    expect($('link[rel="canonical"]').attr('href')).toBe(`${SITE_URL}${pagePath}`)
  })

  it('renders the copy title as its one h1', () => {
    expect($('h1').length).toBe(1)
    expect($('h1').text().trim()).toBe(title)
  })

  it('carries at least 500 characters of visible text', () => {
    expect(visibleText($).length).toBeGreaterThanOrEqual(500)
  })

  it('leaves no unfilled copy placeholder in the text', () => {
    expect(visibleText($)).not.toMatch(/\{[a-zA-Z]+\}/)
  })

  it('links the four text pages from its footer and marks itself current', () => {
    const links = $('footer nav a').map((_, a) => $(a).attr('href')).get()
    expect(links).toEqual(['/about', '/contact', AGENT_PATHS.developers, '/privacy'])
    expect($('footer nav a[aria-current="page"]').attr('href')).toBe(pagePath)
  })

  it('ships no HTML comment to the DOM (W16)', () => {
    expect(readFileSync(path.join(distDir, file), 'utf-8')).not.toContain('<!--')
  })
})

describe('/about', () => {
  const $ = page('about.html')

  it('renders every about section, with person.longBio under the background heading', () => {
    const sections = $('main section').map((_, s) => ({heading: $(s).find('h2').text().trim(), body: $(s).find('p').text().trim()})).get()
    expect(sections).toEqual([
      {heading: identity.about.backgroundHeading, body: identity.person.longBio},
      {heading: identity.about.workHeading, body: identity.about.work},
      {heading: identity.about.siteHeading, body: identity.about.site},
      {heading: identity.about.outsideHeading, body: identity.about.outside}
    ])
  })
})

describe('/contact', () => {
  const $ = page('contact.html')
  const [linkedin, github] = identity.person.sameAs

  it('shows only the channels the site already publishes: the email, LinkedIn, and GitHub', () => {
    const hrefs = $('main section a').map((_, a) => $(a).attr('href')).get()
    expect(hrefs).toEqual([`mailto:${identity.person.email}`, linkedin, github])
    expect($('[data-channel="email"] a').text()).toBe(identity.person.email)
    expect($('[data-channel="linkedin"] a').text()).toBe(identity.contact.linkedinLabel)
    expect($('[data-channel="github"] a').text()).toBe(identity.contact.githubLabel)
    // Each label sits on the profile of its own host, whatever order sameAs lists them in.
    expect(new URL($('[data-channel="linkedin"] a').attr('href')!).hostname).toMatch(/(^|\.)linkedin\.com$/)
    expect(new URL($('[data-channel="github"] a').attr('href')!).hostname).toMatch(/(^|\.)github\.com$/)
  })

  it('states the security-report note under its own heading', () => {
    expect(visibleText($)).toContain(identity.contact.securityHeading)
    expect(visibleText($)).toContain(identity.contact.security)
  })
})

describe('/developers', () => {
  const $ = page('developers.html')
  const d = llm.developers

  it('renders every developer section heading from copy', () => {
    const headings = $('main section h2').map((_, h) => $(h).text().trim()).get()
    expect(headings).toEqual([d.apiHeading, d.mcpHeading, d.webmcpHeading, d.llmsHeading, d.feedsHeading, d.cachingHeading, d.focusHeading, d.usageHeading])
  })

  it('lists the nine JSON exports at the host /openapi.json declares, from the agent catalog', () => {
    const exports = $('#api li a').map((_, a) => ({href: $(a).attr('href'), name: $(a).text()})).get()
    expect(exports).toEqual(DATA_SOURCES.map((s: {url: string; name: string}) => ({href: s.url, name: s.name})))
    expect(exports).toHaveLength(9)
  })

  it('lists the WebMCP tools from the agent catalog', () => {
    expect($('#webmcp li code').map((_, c) => $(c).text()).get()).toEqual(TOOLS.map((t: {name: string}) => t.name))
  })

  it('links the MCP server, its card, the OpenAPI document, and the LLM documents', () => {
    const hrefs = new Set($('main a').map((_, a) => $(a).attr('href')).get())
    for (
      const p of [AGENT_PATHS.mcp, AGENT_PATHS.serverCard, AGENT_PATHS.openapi, LLMS_TXT_PATH, LLM_CONTENT_PATHS.llmsFull, LLM_CONTENT_PATHS.indexMarkdown]
    ) {
      expect(hrefs.has(`${SITE_URL}${p}`), p).toBe(true)
    }
  })

  it('advertises only site URLs the site serves: a built file or a named agent or LLM route', () => {
    const routes = new Set<string>([
      ...Object.values(AGENT_PATHS) as string[],
      LLMS_TXT_PATH,
      LLM_CONTENT_PATHS.llmsFull,
      LLM_CONTENT_PATHS.indexMarkdown,
      ...FEED_ARTIFACTS.map((f) => f.path)
    ])
    const sitePaths = $('main a').map((_, a) => $(a).attr('href')).get().filter((h: string) => h.startsWith(SITE_URL)).map((h: string) =>
      new URL(h).pathname
    )
    expect(sitePaths.length).toBeGreaterThan(0)
    for (const p of sitePaths) {
      expect(routes.has(p), `${p} is linked from /developers but is not a known served route`).toBe(true)
    }
  })

  it('states the usage terms the Content-Usage header carries', () => {
    expect(visibleText($)).toContain(`Content-Usage: ${CONTENT_USAGE}`)
  })
})

describe('/privacy on the shared layout', () => {
  const $ = page('privacy.html')

  it('stays noindex and keeps its six sections', () => {
    expect($('meta[name="robots"]').attr('content')).toBe('noindex, follow')
    expect($('h1').text().trim()).toBe(identity.privacy.title)
    expect($('main section h2')).toHaveLength(6)
  })
})
