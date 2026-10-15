# Route inventory for the Workers move (atlas decision 0160, plan Step 0.5)

Measured 2026-10-13 at `origin/main` `3e3ec120`. Steps 3.2 and 3.6 use this table. Rows marked
"pending 0158" come from the open, owner-gated decision 0158 PRs, read read-only from their
branches: website #348 (`agent-readiness-0158-interfaces`) and #350
(`agent-readiness-0158-content`). Website #347 rewrites a skill and adds no route. PR A ports only
what `main` has; when a 0158 PR merges first, PR A rebases and ports its routes (Step 3.2).

## Files under `functions/` at `3e3ec120`

14 files, 1,627 lines. The plan counted 14 files and 1,316 lines at `7b4c8b7`; the gap is PR 0b
(website #351) growing `_lib/proxy.ts`.

| File (Pages)                       | Lines | Now (PR A)                       |
| ---------------------------------- | ----: | -------------------------------- |
| `functions/_middleware.ts`         |   246 | `src/lib/edge/middleware.ts`     |
| `functions/_lib/proxy.ts`          |   858 | `src/lib/edge/proxy.ts`          |
| `functions/_lib/feed-artifacts.ts` |    58 | `src/lib/edge/feed-artifacts.ts` |
| `functions/_lib/llms-artifacts.ts` |    54 | `src/lib/edge/llms-artifacts.ts` |
| `functions/llms.txt.ts`            |     7 | `src/pages/llms.txt.ts`          |
| `functions/llms-full.txt.ts`       |    13 | `src/pages/llms-full.txt.ts`     |
| `functions/index.md.ts`            |    13 | `src/pages/index.md.ts`          |
| `functions/feed.xml.ts`            |    10 | `src/pages/feed.xml.ts`          |
| `functions/feed.json.ts`           |    10 | `src/pages/feed.json.ts`         |
| `functions/sa.ts`                  |    47 | `src/pages/sa.ts`                |
| `functions/cf-insights.js.ts`      |    51 | `src/pages/cf-insights.js.ts`    |
| `functions/cf-rum.ts`              |    63 | `src/pages/cf-rum.ts`            |
| `functions/api/csp-report.ts`      |    45 | `src/pages/api/csp-report.ts`    |
| `functions/simple/[[path]].ts`     |   152 | `src/pages/simple/[...path].ts`  |

From #348, ported on 2026-10-14 (merge of `main` at `3e0a516d`): `functions/_lib/agent-catalog.mjs`,
`agent-paths.mjs` and `mcp-server.ts` moved to `src/lib/edge/`; `functions/mcp/index.ts` and
`functions/mcp/server-card.ts` became the on-demand endpoints `src/pages/mcp/index.ts` and
`src/pages/mcp/server-card.ts`, both in `EDGE_ROUTES` and `run_worker_first`; the
`_middleware.ts` and `_lib/proxy.ts` edits landed in `src/lib/edge/middleware.ts` and
`src/lib/edge/proxy.ts`. `/.well-known/ai-catalog.json` and `/openapi.json` joined
`HEADER_OVERRIDE_PATHS`, because the middleware sets their Content-Type. From #350: `functions/_lib/not-found-markdown.mjs` (4, generated),
`functions/_lib/site-paths.ts` (13), plus an edit to `_middleware.ts` (+35/-10).

## Routes and methods

Measured against production Pages at its origin alias `https://human-datastream.pages.dev` (no
zone rule applies there) and at `https://jonathanlloyd.me`.

| Route                                      | Handler (Pages export)    | Methods it handles                   | Other methods                          |
| ------------------------------------------ | ------------------------- | ------------------------------------ | -------------------------------------- |
| `/` (middleware)                           | `_middleware` `onRequest` | GET, HEAD (Markdown negotiation)     | static plane: 405, empty               |
| every path except the code-free prefixes   | `_middleware`             | wraps every response                 | —                                      |
| `/llms.txt`, `/llms-full.txt`, `/index.md` | `onRequest`               | GET, HEAD                            | 405 `Allow: GET, HEAD` (handler)       |
| `/feed.xml`, `/feed.json`                  | `onRequest`               | GET, HEAD                            | 405 `Allow: GET, HEAD` (handler)       |
| `/sa`, `/cf-insights.js`                   | `onRequest`               | every method (always fetches)        | —                                      |
| `/cf-rum`                                  | `onRequest`               | POST forwards; any other method 204  | —                                      |
| `/api/csp-report`                          | `onRequestPost`           | POST (415 unless a report type)      | GET/HEAD: 404 page; others: 405, empty |
| `/simple`, `/simple/*`                     | `onRequest` (`[[path]]`)  | every method, bare `/simple` too     | —                                      |
| `/mcp` (pending 0158)                      | `onRequest`               | POST; OPTIONS; GET and DELETE 405    | 405 `Allow: POST`                      |
| `/mcp/server-card` (pending 0158)          | `onRequest`               | GET, HEAD, OPTIONS (CORS, ETag, 304) | 405 `Allow: GET, HEAD, OPTIONS`        |

Code-free prefixes (`public/_routes.json` excluded them from Functions): `/_astro/*`, `/fonts/*`,
`/css/*`, `/vendor/*`, `/assets/*`. Their responses carried the `_headers` policy alone, without
the CSP trio.

A Pages Function route also matched its path with a trailing slash (`/llms.txt/` answered 200).

## Request table

`H` = `Accept: text/html`, `M` = `Accept: text/markdown`. Status on production Pages,
2026-10-13. "Static 405" is the Pages static plane's empty 405 with
`Access-Control-Allow-Origin: *`.

| Path                                                                | GET (H)                                   | HEAD (H) | POST                 | GET (M)                                   | Known path | Notes                                                                   |
| ------------------------------------------------------------------- | ----------------------------------------- | -------- | -------------------- | ----------------------------------------- | ---------- | ----------------------------------------------------------------------- |
| `/`                                                                 | 200 html                                  | 200      | static 405           | 200 `text/markdown` (llms-full)           | yes        | `Vary: Accept`, `Link`, `No-Vary-Search`, `CDN-Cache-Control: no-store` |
| `/privacy`                                                          | 200 html                                  | 200      | static 405           | 200 html                                  | yes        | never negotiates                                                        |
| `/privacy/`, `/privacy.html`                                        | 308 → `/privacy`                          | 308      | —                    | 308                                       | yes        | query string kept                                                       |
| `/offline`                                                          | 200 html                                  | 200      | static 405           | 200 html                                  | yes        |                                                                         |
| `/404`                                                              | 200 html                                  | 200      | —                    | 200 html                                  | yes        |                                                                         |
| `/index.html`                                                       | 308 → `/`                                 | 308      | —                    | 308                                       | yes        |                                                                         |
| unknown (`/no-such-page`)                                           | 404 html, no-store                        | 404      | static 405           | 404 html                                  | no         |                                                                         |
| unknown code-free (`/_astro/x.js`)                                  | 404 html, no CSP                          | 404      | static 405           | 404 html                                  | no         |                                                                         |
| `/focus.json`                                                       | 404                                       | 404      | —                    | 404                                       | no         | the site serves no focus signal                                         |
| `/robots.txt`, `/humans.txt`                                        | 200 text                                  | 200      | static 405           | 200 text                                  | yes        | robots: `max-age=3600, s-maxage=86400`                                  |
| `/sitemap-index.xml`                                                | 200 xml                                   | 200      | —                    | 200 xml                                   | yes        |                                                                         |
| `/manifest.webmanifest`                                             | 200                                       | 200      | —                    | 200                                       | yes        |                                                                         |
| `/sw.js`, `/version.json`                                           | 200                                       | 200      | —                    | 200                                       | yes        | `Cache-Control: max-age=0, no-store` (middleware)                       |
| `/.well-known/api-catalog`                                          | 200 `application/linkset+json; profile=…` | 200      | —                    | 200                                       | yes        | type from middleware                                                    |
| `/.well-known/webfinger`                                            | 200 `application/jrd+json`, CORS \*       | 200      | —                    | 200                                       | yes        | type from middleware                                                    |
| `/.well-known/ai-catalog.json`, `/.well-known/mcp/server-card.json` | 200 json                                  | 200      | —                    | 200                                       | yes        |                                                                         |
| `/llms.txt`                                                         | 200 text/plain                            | 200      | 405 (handler)        | 200 text/plain                            | yes        | `/llms.txt/` also 200                                                   |
| `/llms-full.txt`, `/index.md`                                       | 200 text/markdown                         | 200      | 405 (handler)        | 200 text/markdown                         | yes        |                                                                         |
| `/feed.xml`, `/feed.json`                                           | 200                                       | 200      | 405 (handler)        | 200 (no negotiation)                      | yes        |                                                                         |
| `/sa`, `/cf-insights.js`                                            | 200 JS                                    | 200      | 200                  | 200                                       | yes        |                                                                         |
| `/cf-rum`                                                           | 204                                       | 204      | forwards (2xx → 204) | 204                                       | yes        |                                                                         |
| `/api/csp-report`                                                   | 404 page                                  | 404      | 415 or 204           | 404 page                                  | yes        | PUT: static 405                                                         |
| `/simple`, `/simple/`                                               | 200 (upstream)                            | 200      | forwards             | 200                                       | yes        |                                                                         |
| `/about`, `/contact`, `/developers` (pending 0158 #350)             | 404 today; 200 html after #350            |          |                      | 200 html                                  | after #350 | prerendered pages                                                       |
| Markdown 404 (pending 0158 #350)                                    | —                                         | —        | —                    | unknown path under M: 404 `text/markdown` | —          | middleware; `Vary: Accept`, `CDN-Cache-Control: no-store` on every 404  |
| `/mcp` (pending 0158 #348)                                          | 405                                       | 405      | 200 JSON-RPC         | 405                                       | after #348 |                                                                         |
| `/mcp/server-card` (pending 0158 #348)                              | 200 card + ETag                           | 200      | 405                  | 200                                       | after #348 |                                                                         |
| `/openapi.json`, `/.well-known/ard.json` (pending 0158 #348)        | 200 json                                  | 200      | —                    | 200                                       | after #348 | type from middleware                                                    |

## Copy keys the site reads

From `@j0nathan-ll0yd/copy` 3.3.0 (pinned exactly in `package.json`):

- `identity`: `a11y.ogImageAlt`, `a11y.skipToMain`, `feed.title`, `humansTxt.hosting`,
  `humansTxt.stack`, `humansTxt.standards`, `humansTxt.thanks`, `person.*` (`alumniOf`,
  `alumniOfUrl`, `employer`, `employerUrl`, `experiencePhrase`, `firstName`, `handle`, `interests`,
  `jobTitle`, `lastName`, `location`, `longBio`, `name`, `sameAs`, `shortBio`, `socialBio`),
  `seo.expertise`, `seo.keywords`, `seo.title`, `site.description`, `site.fullName`, `site.name`,
  `site.pwaDescription`.
- `llm`: `dashboard.alternateLinkMarkdown`, `dashboard.alternateLinkPlain`,
  `dashboard.datasetDescription`, `agentDiscovery.*` (six keys), `mcp.*` (31 keys, including
  `mcp.stackHosting`).
- `profile`: `card`, `terminal`.
- `a11y`: `clock.currentTime`, `css`, `nav.dashboard`, `nav.profile`, `ogImageAlt`,
  `page404.region`, `region.body`, `region.mind`, `skipToMain`.
- `app`: `page404.description`, `page404.title`, `sections.body`, `sections.mind`.
- `widgets`: `systemStatus.valueOffline`.

The two hosting strings, `identity.humansTxt.hosting` ("Cloudflare Pages") and `llm.mcp.stackHosting`
("Cloudflare Pages via GitHub Actions"), change in the Step 1.7 copy release. No release carries
them yet: 4.0.0 is the decision 0158 major, which #348 and #350 adopt.
