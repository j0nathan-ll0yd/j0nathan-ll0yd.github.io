// Generates public/js/webmcp.js — the static WebMCP client script served raw
// (NOT bundled) to expose navigator.modelContext tools to MCP-aware browsers.
//
// All CloudFront addressing is sourced from @lifegames/portal-contract so the
// raw served file never hardcodes the CDN host. Run via `npm run generate:webmcp`
// (wired into prebuild). The output is byte-stable across runs.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CLOUDFRONT_BASE,
  ENDPOINTS,
  LLM_CONTENT_PATHS,
} from '@lifegames/portal-contract/constants';

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
      site: 'https://jonathanlloyd.me',
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
                discoveryIndex: 'https://jonathanlloyd.me/llms.txt',
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
