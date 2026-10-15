// On-demand route: proxy /index.md from CloudFront.
// index.md is the same-composition byte-identical alias of llms-full.txt (for agents
// expecting .md extensions); this route ensures it resolves on jonathanlloyd.me,
// not only on the raw CloudFront host.

import {LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy} from '../lib/edge/proxy'
import {edgeRoute} from '../lib/edge/routes'

export const onRequest = makeCloudfrontProxy({
  path: LLM_CONTENT_PATHS.indexMarkdown,
  contentType: 'text/markdown; charset=utf-8',
  cachePolicy: LLM_OUTPUT_CACHE_POLICY
})

// On-demand: this route runs in the Worker on every request (atlas decision 0160, PR A).
export const prerender = false
export const ALL = edgeRoute(onRequest)
