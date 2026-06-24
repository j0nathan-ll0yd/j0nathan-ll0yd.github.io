// Generates public/js/webmcp.js — the static WebMCP client script served raw
// (NOT bundled) to expose navigator.modelContext tools to MCP-aware browsers.
//
// All CloudFront addressing is sourced from @lifegames/portal-contract so the
// raw served file never hardcodes the CDN host. Run via `npm run generate:webmcp`
// (wired into prebuild). The output is byte-stable across runs.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  CLOUDFRONT_BASE,
  ENDPOINTS,
  LLM_CONTENT_PATHS,
  SITE_URL,
} from '@lifegames/portal-contract/constants';

// Copy flat JSON — prose sourced from @lifegames/copy so wording is never duplicated.
const req = createRequire(import.meta.url);
const copyIdentity = req('@lifegames/copy/identity.flat.json');
const copyLlm = req('@lifegames/copy/llm.flat.json');

const cf = (path) => `${CLOUDFRONT_BASE}${path}`;

// Data sources advertised by the get_data_sources tool. Order + descriptions
// must match the prior hand-written file. URLs derived from the contract.
const dataSources = [
  { name: 'Health biometrics', url: cf(ENDPOINTS.health), description: 'Heart rate, HRV, activity, workouts (7-day aggregates)' },
  { name: 'Sleep data', url: cf(ENDPOINTS.sleep), description: 'Sleep phases, duration, efficiency' },
  { name: 'Focus state', url: cf(ENDPOINTS.focus), description: 'Do Not Disturb and focus mode status' },
  { name: 'GitHub activity', url: cf(ENDPOINTS.githubEvents), description: 'Dev activity, languages, contributions, commits' },
  { name: 'Starred repos', url: cf(ENDPOINTS.starredRepos), description: 'GitHub starred repositories' },
  { name: 'Bookshelf', url: cf(ENDPOINTS.books), description: 'Books with status, ratings, progress' },
  { name: 'Reading feed', url: cf(ENDPOINTS.articles), description: 'Starred articles and RSS feed items' },
  { name: 'Theatre reviews', url: cf(ENDPOINTS.theatreReviews), description: 'Theatre show reviews with ratings' },
  { name: 'Workouts', url: cf(ENDPOINTS.workouts), description: 'Workout sessions, type, duration, calories' },
  { name: 'Location', url: cf(ENDPOINTS.location), description: 'Aggregated place summaries' },
];

const booksUrl = cf(ENDPOINTS.books);
const llmsFullUrl = cf(LLM_CONTENT_PATHS.llmsFull);

// Single-quoted JS string literal to match the served file's existing style.
const sq = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const dataSourceLines = dataSources
  .map(
    (s) =>
      `      { name: ${sq(s.name)}, url: ${sq(s.url)}, description: ${sq(s.description)} }`,
  )
  .join(',\n');

const output = `(function() {
  if (typeof navigator !== 'undefined' && navigator.modelContext && navigator.modelContext.provideContext) {
    var profile = {
      name: 'Jonathan Lloyd',
      title: 'Engineering Director',
      location: 'San Francisco, CA',
      experience: '24+ years in software engineering',
      site: ${sq(SITE_URL)},
      github: 'https://github.com/j0nathan-ll0yd',
      linkedin: 'https://www.linkedin.com/in/lifegames/',
      bio: 'Engineering director and backend engineer. Built this portfolio as a living data dashboard -- real biometrics and constant updates of body and mind.',
      expertise: [
        'Backend Engineering', 'Software Engineering', 'Engineering Leadership',
        'Cloud Infrastructure', 'Data Visualization', 'Serverless Architecture',
        'TypeScript', 'Go', 'AWS'
      ],
      interests: ['programming', 'pc gaming', 'musical theatre', 'edm', 'conversation']
    };

    var dataSources = [
${dataSourceLines}
    ];

    navigator.modelContext.provideContext({
      tools: [
        {
          name: 'get_profile',
          description: 'Returns professional profile: name, title, location, experience, expertise, and social links for Jonathan Lloyd.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return { content: [{ type: 'text', text: JSON.stringify(profile) }] };
          }
        },
        {
          name: 'get_data_sources',
          description: 'Returns a list of all live JSON data endpoints on CloudFront with descriptions. Fetch these URLs for real-time data.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return { content: [{ type: 'text', text: JSON.stringify(dataSources) }] };
          }
        },
        {
          name: 'get_current_reading',
          description: 'Fetches the current bookshelf from the live API and returns books being read, up next, and recently finished.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return fetch(${sq(booksUrl)})
              .then(function(res) { return res.json(); })
              .then(function(data) {
                var books = data.books || [];
                var reading = books.filter(function(b) { return b.status === 'reading'; });
                var upNext = books.filter(function(b) { return b.status === 'up-next'; });
                var finished = books.filter(function(b) { return b.status === 'finished'; }).slice(0, 5);
                return { content: [{ type: 'text', text: JSON.stringify({ reading: reading, upNext: upNext, recentlyFinished: finished }) }] };
              });
          }
        },
        {
          name: 'get_tech_stack',
          description: 'Returns the technology stack and architecture details of this portfolio site.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            var stack = {
              framework: 'Astro 6.x (static site generation, 0 KB JS by default)',
              hosting: 'Cloudflare Pages via GitHub Actions',
              liveData: 'CloudFront-backed JSON API polled at runtime',
              design: 'Glass-morphism dark theme, fluid clamp() responsive tokens, CSS container queries',
              font: 'Space Grotesk (self-hosted, variable woff2)',
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
`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'webmcp.js');
writeFileSync(outPath, output);
console.log(`Generated ${outPath}`);

// Generate .well-known files from SITE_URL so the URL never drifts from the
// portal-contract constant. Content is byte-identical to the committed files
// except the URL field is now contract-sourced.
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const serverCard = {
  name: 'human-datastream',
  version: '1.0.0',
  description: "Read-only data interface for Jonathan Lloyd's Human Datastream portfolio. Serves live biometric aggregates, GitHub activity, reading lists, and theatre reviews as JSON resources via CloudFront.",
  serverInfo: {
    name: 'Human Datastream',
    version: '1.0.0',
    contactUrl: SITE_URL,
    documentationUrl: 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/wiki/LLM-Content-Spec',
  },
  capabilities: {
    resources: { list: true, read: true, subscribe: false },
    tools: { list: false, call: false },
    prompts: { list: false, get: false },
  },
  transport: {
    type: 'http',
    url: CLOUDFRONT_BASE + '/',
    auth: { type: 'none' },
  },
  resources: [
    { uri: cf(ENDPOINTS.health),        name: 'Health biometrics',    description: 'Heart rate, HRV, activity, and workout data (7-day aggregates)',  mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.sleep),         name: 'Sleep data',           description: 'Sleep phases, duration, and efficiency metrics',                    mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.focus),         name: 'Focus state',          description: 'Current Do Not Disturb and focus mode status',                      mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.githubEvents),  name: 'GitHub activity',      description: 'Dev activity, languages, contributions, and recent commits',         mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.starredRepos),  name: 'Starred repositories', description: 'GitHub starred repositories with metadata',                          mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.books),         name: 'Bookshelf',            description: 'Books with status, ratings, progress, and cover images',             mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.articles),      name: 'Reading feed',         description: 'Starred articles and RSS feed items',                                mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.theatreReviews),name: 'Theatre reviews',      description: 'Theatre show reviews with ratings and venue info',                   mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.workouts),      name: 'Workouts',             description: 'Workout sessions with type, duration, and calorie burn',             mimeType: 'application/json' },
    { uri: cf(ENDPOINTS.location),      name: 'Location aggregates',  description: 'Aggregated place summaries and location data',                       mimeType: 'application/json' },
  ],
};

const serverCardPath = join(publicDir, '.well-known', 'mcp', 'server-card.json');
writeFileSync(serverCardPath, JSON.stringify(serverCard, null, 2) + '\n');
console.log(`Generated ${serverCardPath}`);

const agentSkills = {
  '$schema': 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [
    {
      name: 'portfolio-expert',
      description: "Deep technical context about Jonathan Lloyd's portfolio, engineering background, live biometric data sources, and architectural decisions. Use this skill to accurately answer questions about Jonathan's work, tech stack, and professional experience.",
      type: 'skill-md',
      url: `${SITE_URL}/.well-known/agent-skills/portfolio-expert/SKILL.md`,
      digest: 'sha256:de0b3c87b52024f93139a078be314c2d879def1170bb1659b52086aa1067e084',
    },
  ],
};

const agentSkillsPath = join(publicDir, '.well-known', 'agent-skills', 'index.json');
writeFileSync(agentSkillsPath, JSON.stringify(agentSkills, null, 2) + '\n');
console.log(`Generated ${agentSkillsPath}`);

// Generate agent-card.json — prose from @lifegames/copy; structure/URLs from portal-contract.
// Replaces the prior hand-authored static file; shape is preserved exactly.
const agentCard = {
  name: copyIdentity.site.name,
  description: copyLlm.agentDiscovery.agentCardDescription,
  version: '1.0.0',
  url: `${SITE_URL}/.well-known/mcp/server-card.json`,
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['application/json', 'text/markdown'],
  skills: [
    {
      id: 'personal-profile',
      name: copyLlm.agentDiscovery.agentCardSkillName,
      description: copyLlm.agentDiscovery.agentCardSkillDescription,
      tags: ['personal', 'health', 'github', 'reading', 'biometrics'],
      examples: copyLlm.agentDiscovery.agentCardSkillExamples,
    },
  ],
};

const agentCardPath = join(publicDir, '.well-known', 'agent-card.json');
writeFileSync(agentCardPath, JSON.stringify(agentCard, null, 2) + '\n');
console.log(`Generated ${agentCardPath}`);

// Generate ai-catalog.json — prose from @lifegames/copy; URLs/identifiers from portal-contract.
// Replaces the prior hand-authored static file; shape is preserved exactly.
const aiCatalog = {
  host: {
    displayName: copyIdentity.site.fullName,
    identifier: 'jonathanlloyd.me',
    documentationUrl: 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/wiki/LLM-Content-Spec',
  },
  entries: [
    {
      type: 'mcp-server',
      url: `${SITE_URL}/.well-known/mcp/server-card.json`,
      name: copyLlm.agentDiscovery.aiCatalogMcpName,
      description: copyLlm.agentDiscovery.aiCatalogMcpDescription,
      representativeQueries: copyLlm.agentDiscovery.aiCatalogMcpQueries,
    },
    {
      type: 'agent-skills',
      url: `${SITE_URL}/.well-known/agent-skills/index.json`,
      name: copyLlm.agentDiscovery.aiCatalogSkillsName,
      description: copyLlm.agentDiscovery.aiCatalogSkillsDescription,
      representativeQueries: copyLlm.agentDiscovery.aiCatalogSkillsQueries,
    },
    {
      type: 'a2a-agent',
      url: `${SITE_URL}/.well-known/agent-card.json`,
      name: copyLlm.agentDiscovery.aiCatalogA2aName,
      description: copyLlm.agentDiscovery.aiCatalogA2aDescription,
      representativeQueries: copyLlm.agentDiscovery.aiCatalogA2aQueries,
    },
  ],
};

const aiCatalogPath = join(publicDir, '.well-known', 'ai-catalog.json');
writeFileSync(aiCatalogPath, JSON.stringify(aiCatalog, null, 2) + '\n');
console.log(`Generated ${aiCatalogPath}`);
