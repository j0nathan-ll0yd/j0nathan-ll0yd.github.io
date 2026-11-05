import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
// /llms.txt has no dedicated LLM_CONTENT_PATHS constant. The path is derived once, in
// src/lib/edge/llms-artifacts.ts, from the contract's own distribution registry.
import {LLMS_TXT_PATH} from '../lib/edge/llms-artifacts'
import {SITEMAP_INDEX_PATH} from '../lib/edge/site-paths'

export const prerender = true

export function GET(): Response {
  const sitemap = `${SITE_URL}${SITEMAP_INDEX_PATH}`

  const body = `# Crawlers
User-agent: *
Allow: /

# AI training bots -- blocked from the dashboard. The LLM discovery
# index (${LLMS_TXT_PATH}) stays allowed per Option A of the LLM Content
# Delivery plan. This file binds this host only. The rich variants and JSON
# exports that ${LLMS_TXT_PATH} links live on a separate CloudFront origin,
# which answers for its own /robots.txt.
User-agent: GPTBot
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: ClaudeBot
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: CCBot
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Google-Extended
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Google-CloudVertexBot
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Bytespider
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Meta-ExternalAgent
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Applebot-Extended
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Amazonbot
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: MistralAI-Training
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Webzio-extended
Allow: ${LLMS_TXT_PATH}
Disallow: /

# AI search/answer agents -- each named in its own group and allowed to read
# the full site, matching the search permission sent in the site's HTTP
# response headers. The user-initiated fetchers (ChatGPT-User, Claude-User,
# Perplexity-User, Meta-ExternalFetcher) sit in this block.
# PerplexityBot has no separate training token, so it is NOT in the trainer
# block above -- it inherits Allow: / from User-agent: *.
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Meta-ExternalFetcher
Allow: /

# LLM context: ${SITE_URL}${LLMS_TXT_PATH}
Sitemap: ${sitemap}
`.trimStart()

  return new Response(body, {headers: {'Content-Type': 'text/plain; charset=utf-8'}})
}
