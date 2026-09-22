import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
// /llms.txt has no dedicated LLM_CONTENT_PATHS constant. The path is derived once, in
// functions/_lib/llms-artifacts.ts, from the contract's own distribution registry.
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts'

export const prerender = true

export function GET(): Response {
  const sitemap = `${SITE_URL}/sitemap-index.xml`

  const body = `# Crawlers
User-agent: *
Allow: /

# AI scraping/training bots -- blocked from visual dashboard,
# LLM discovery index (${LLMS_TXT_PATH}) allowed per Option A of the
# LLM Content Delivery plan. Rich variants live on CloudFront
# (see ${LLMS_TXT_PATH} for URLs) and are governed separately.
# AI search agents (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User,
# Perplexity-User) inherit Allow: / from User-agent: * above.
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

User-agent: Meta-ExternalFetcher
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Applebot-Extended
Allow: ${LLMS_TXT_PATH}
Disallow: /

User-agent: Amazonbot
Allow: ${LLMS_TXT_PATH}
Disallow: /

# AI search/answer agents -- explicitly allowed to read the full site,
# matching the search permission sent in the site's HTTP response headers.
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

# LLM context: ${SITE_URL}${LLMS_TXT_PATH}
Sitemap: ${sitemap}
`.trimStart()

  return new Response(body, {headers: {'Content-Type': 'text/plain; charset=utf-8'}})
}
