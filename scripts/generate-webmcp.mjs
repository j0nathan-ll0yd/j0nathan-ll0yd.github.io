// Generates public/js/webmcp.js — the static WebMCP client script served raw
// (NOT bundled) to expose navigator.modelContext tools to MCP-aware browsers.
//
// All CloudFront addressing is sourced from @lifegames/portal-contract so the
// raw served file never hardcodes the CDN host. Run via `npm run generate:webmcp`
// (wired into prebuild). The output is byte-stable across runs.
//
// All customer-facing prose is sourced from @lifegames/copy (identity + llm
// namespaces). Zero prose is hardcoded in this file.
import {writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {createRequire} from 'node:module'
import {CLOUDFRONT_BASE, ENDPOINTS, LLM_CONTENT_PATHS, SITE_URL} from '@lifegames/portal-contract/constants'

// Copy flat JSON — prose sourced from @lifegames/copy so wording is never duplicated.
const req = createRequire(import.meta.url)
const copyIdentity = req('@lifegames/copy/identity.flat.json')
const copyLlm = req('@lifegames/copy/llm.flat.json')

const cf = (path) => `${CLOUDFRONT_BASE}${path}`

// Data sources advertised by the get_data_sources tool and server-card resources[].
// Name and description come from copy (mcp.ds*Name / mcp.ds*Desc) so both surfaces
// share the same canonical wording. URLs derived from the contract.
const dataSources = [
  {name: copyLlm.mcp.dsHealthName, url: cf(ENDPOINTS.health), description: copyLlm.mcp.dsHealthDesc},
  {name: copyLlm.mcp.dsSleepName, url: cf(ENDPOINTS.sleep), description: copyLlm.mcp.dsSleepDesc},
  {name: copyLlm.mcp.dsFocusName, url: cf(ENDPOINTS.focus), description: copyLlm.mcp.dsFocusDesc},
  {name: copyLlm.mcp.dsGithubEventsName, url: cf(ENDPOINTS.githubEvents), description: copyLlm.mcp.dsGithubEventsDesc},
  {name: copyLlm.mcp.dsStarredReposName, url: cf(ENDPOINTS.starredRepos), description: copyLlm.mcp.dsStarredReposDesc},
  {name: copyLlm.mcp.dsBooksName, url: cf(ENDPOINTS.books), description: copyLlm.mcp.dsBooksDesc},
  {name: copyLlm.mcp.dsArticlesName, url: cf(ENDPOINTS.articles), description: copyLlm.mcp.dsArticlesDesc},
  {name: copyLlm.mcp.dsTheatreReviewsName, url: cf(ENDPOINTS.theatreReviews), description: copyLlm.mcp.dsTheatreReviewsDesc},
  {name: copyLlm.mcp.dsWorkoutsName, url: cf(ENDPOINTS.workouts), description: copyLlm.mcp.dsWorkoutsDesc},
  {name: copyLlm.mcp.dsLocationName, url: cf(ENDPOINTS.location), description: copyLlm.mcp.dsLocationDesc}
]

const booksUrl = cf(ENDPOINTS.books)
// llms-full.txt is advertised at its prod-domain path (proxied by
// functions/llms-full.txt.ts), keeping agents on jonathanlloyd.me; the raw
// JSON dataSources above stay on CloudFront (no prod-domain proxy exists for them).
const llmsFullUrl = `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`

// Single-quoted JS string literal to match the served file's existing style.
const sq = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

// GitHub and LinkedIn URLs come from person.sameAs (canonical profile URLs).
// Convention: sameAs[0] = LinkedIn, sameAs[1] = GitHub.
const linkedinUrl = copyIdentity.person.sameAs[0]
const githubUrl = copyIdentity.person.sameAs[1]

const dataSourceLines = dataSources.map((s) => `      { name: ${sq(s.name)}, url: ${sq(s.url)}, description: ${sq(s.description)} }`).join(',\n')

const expertiseLines = copyIdentity.seo.expertise.map((e) => sq(e)).join(', ')

const interestsLines = copyIdentity.person.interests.map((i) => sq(i)).join(', ')

const output = `(function() {
  if (typeof navigator !== 'undefined' && navigator.modelContext && navigator.modelContext.provideContext) {
    var profile = {
      name: ${sq(copyIdentity.person.name)},
      title: ${sq(copyIdentity.person.jobTitle)},
      location: ${sq(copyIdentity.person.location)},
      experience: ${sq(copyIdentity.person.experiencePhrase)},
      site: ${sq(SITE_URL)},
      github: ${sq(githubUrl)},
      linkedin: ${sq(linkedinUrl)},
      bio: ${sq(copyIdentity.person.longBio)},
      expertise: [
        ${expertiseLines}
      ],
      interests: [${interestsLines}]
    };

    var dataSources = [
${dataSourceLines}
    ];

    navigator.modelContext.provideContext({
      tools: [
        {
          name: 'get_profile',
          description: ${sq(copyLlm.mcp.toolGetProfile)},
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return { content: [{ type: 'text', text: JSON.stringify(profile) }] };
          }
        },
        {
          name: 'get_data_sources',
          description: ${sq(copyLlm.mcp.toolGetDataSources)},
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return { content: [{ type: 'text', text: JSON.stringify(dataSources) }] };
          }
        },
        {
          name: 'get_current_reading',
          description: ${sq(copyLlm.mcp.toolGetCurrentReading)},
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: async function() {
            const res = await fetch(${sq(booksUrl)});
            const data = await res.json();
            const books = data.books || [];
            const reading = books.filter((b) => b.status === 'reading');
            const upNext = books.filter((b) => b.status === 'up-next');
            const finished = books.filter((b) => b.status === 'finished').slice(0, 5);
            return { content: [{ type: 'text', text: JSON.stringify({ reading, upNext, recentlyFinished: finished }) }] };
          }
        },
        {
          name: 'get_tech_stack',
          description: ${sq(copyLlm.mcp.toolGetTechStack)},
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            var stack = {
              framework: ${sq(copyLlm.mcp.stackFramework)},
              hosting: ${sq(copyLlm.mcp.stackHosting)},
              liveData: ${sq(copyLlm.mcp.stackLiveData)},
              design: ${sq(copyLlm.mcp.stackDesign)},
              font: ${sq(copyLlm.mcp.stackFont)},
              llmContent: {
                discoveryIndex: ${sq(SITE_URL + '/llms.txt')},
                complete: ${sq(llmsFullUrl)}
              }
            };
            return { content: [{ type: 'text', text: JSON.stringify(stack) }] };
          }
        }
      ]
    });
  }
})();
`

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'webmcp.js')
writeFileSync(outPath, output)
console.log(`Generated ${outPath}`)

// Generate .well-known files from SITE_URL so the URL never drifts from the
// portal-contract constant. Content is byte-identical to the committed files
// except the URL field is now contract-sourced.
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const serverCard = {
  name: 'human-datastream',
  version: '1.0.0',
  description: copyLlm.mcp.serverDescription,
  serverInfo: {
    name: copyIdentity.site.name,
    version: '1.0.0',
    contactUrl: SITE_URL,
    documentationUrl: 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/wiki/LLM-Content-Spec'
  },
  capabilities: {resources: {list: true, read: true, subscribe: false}, tools: {list: false, call: false}, prompts: {list: false, get: false}},
  transport: {type: 'http', url: CLOUDFRONT_BASE + '/', auth: {type: 'none'}},
  resources: [
    {uri: cf(ENDPOINTS.health), name: copyLlm.mcp.dsHealthName, description: copyLlm.mcp.dsHealthDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.sleep), name: copyLlm.mcp.dsSleepName, description: copyLlm.mcp.dsSleepDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.focus), name: copyLlm.mcp.dsFocusName, description: copyLlm.mcp.dsFocusDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.githubEvents), name: copyLlm.mcp.dsGithubEventsName, description: copyLlm.mcp.dsGithubEventsDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.starredRepos), name: copyLlm.mcp.dsStarredReposName, description: copyLlm.mcp.dsStarredReposDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.books), name: copyLlm.mcp.dsBooksName, description: copyLlm.mcp.dsBooksDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.articles), name: copyLlm.mcp.dsArticlesName, description: copyLlm.mcp.dsArticlesDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.theatreReviews), name: copyLlm.mcp.dsTheatreReviewsName, description: copyLlm.mcp.dsTheatreReviewsDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.workouts), name: copyLlm.mcp.dsWorkoutsName, description: copyLlm.mcp.dsWorkoutsDesc, mimeType: 'application/json'},
    {uri: cf(ENDPOINTS.location), name: copyLlm.mcp.dsLocationName, description: copyLlm.mcp.dsLocationDesc, mimeType: 'application/json'}
  ]
}

const serverCardPath = join(publicDir, '.well-known', 'mcp', 'server-card.json')
writeFileSync(serverCardPath, JSON.stringify(serverCard, null, 2) + '\n')
console.log(`Generated ${serverCardPath}`)

const agentSkills = {
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [
    {
      name: 'portfolio-expert',
      description: copyLlm.mcp.agentSkillDescription,
      type: 'skill-md',
      url: `${SITE_URL}/.well-known/agent-skills/portfolio-expert/SKILL.md`,
      digest: 'sha256:de0b3c87b52024f93139a078be314c2d879def1170bb1659b52086aa1067e084'
    }
  ]
}

const agentSkillsPath = join(publicDir, '.well-known', 'agent-skills', 'index.json')
writeFileSync(agentSkillsPath, JSON.stringify(agentSkills, null, 2) + '\n')
console.log(`Generated ${agentSkillsPath}`)

// Generate agent-card.json — A2A v1.0 AgentCard (normative source: a2aproject/A2A
// specification/a2a.proto). Prose from @lifegames/copy; structure/URLs from portal-contract.
// REQUIRED per the proto: name, description, supportedInterfaces, version, capabilities,
// defaultInputModes, defaultOutputModes, skills. NB: this is a discovery-only card for a
// READ-ONLY data source — there is no live A2A JSON-RPC endpoint, so the single interface
// points at the machine-readable MCP server-card. Pinned to A2A v1.0, verified 2026-07-07.
// See docs/discovery-surface.md.
const agentCard = {
  name: copyIdentity.site.name,
  description: copyLlm.agentDiscovery.agentCardDescription,
  version: '1.0.0',
  supportedInterfaces: [
    {url: `${SITE_URL}/.well-known/mcp/server-card.json`, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0'}
  ],
  capabilities: {streaming: false, pushNotifications: false},
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['application/json', 'text/markdown'],
  skills: [
    {
      id: 'personal-profile',
      name: copyLlm.agentDiscovery.agentCardSkillName,
      description: copyLlm.agentDiscovery.agentCardSkillDescription,
      tags: ['personal', 'health', 'github', 'reading', 'biometrics'],
      examples: copyLlm.agentDiscovery.agentCardSkillExamples
    }
  ]
}

const agentCardPath = join(publicDir, '.well-known', 'agent-card.json')
writeFileSync(agentCardPath, JSON.stringify(agentCard, null, 2) + '\n')
console.log(`Generated ${agentCardPath}`)

// Generate ai-catalog.json — ARD AI Catalog v1.0 (normative source: agenticresourcediscovery/
// ard-spec spec/schemas/ai-catalog.schema.json). Prose from @lifegames/copy; URLs/identifiers
// from portal-contract. REQUIRED: top-level specVersion + entries; each entry needs identifier
// (RFC 8141 urn:air:<publisher>:<namespace>:<name>), displayName, type (IANA media type), and
// exactly one of url/data. host + entries are additionalProperties:false — no stray fields.
// Pinned to ARD specVersion 1.0, verified 2026-07-07. See docs/discovery-surface.md.
const air = (namespace, name) => `urn:air:jonathanlloyd.me:${namespace}:${name}`
const aiCatalog = {
  specVersion: '1.0',
  host: {
    displayName: copyIdentity.site.fullName,
    identifier: 'did:web:jonathanlloyd.me',
    documentationUrl: 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/wiki/LLM-Content-Spec'
  },
  entries: [
    {
      identifier: air('server', 'human-datastream'),
      displayName: copyLlm.agentDiscovery.aiCatalogMcpName,
      type: 'application/mcp-server-card+json',
      url: `${SITE_URL}/.well-known/mcp/server-card.json`,
      description: copyLlm.agentDiscovery.aiCatalogMcpDescription,
      representativeQueries: copyLlm.agentDiscovery.aiCatalogMcpQueries
    },
    {
      // ARD defines no dedicated media type for an agent-skills index; typed as generic JSON.
      identifier: air('skills', 'portfolio-expert'),
      displayName: copyLlm.agentDiscovery.aiCatalogSkillsName,
      type: 'application/json',
      url: `${SITE_URL}/.well-known/agent-skills/index.json`,
      description: copyLlm.agentDiscovery.aiCatalogSkillsDescription,
      representativeQueries: copyLlm.agentDiscovery.aiCatalogSkillsQueries
    },
    {
      identifier: air('agent', 'human-datastream'),
      displayName: copyLlm.agentDiscovery.aiCatalogA2aName,
      type: 'application/a2a-agent-card+json',
      url: `${SITE_URL}/.well-known/agent-card.json`,
      description: copyLlm.agentDiscovery.aiCatalogA2aDescription,
      representativeQueries: copyLlm.agentDiscovery.aiCatalogA2aQueries
    }
  ]
}

const aiCatalogPath = join(publicDir, '.well-known', 'ai-catalog.json')
writeFileSync(aiCatalogPath, JSON.stringify(aiCatalog, null, 2) + '\n')
console.log(`Generated ${aiCatalogPath}`)
