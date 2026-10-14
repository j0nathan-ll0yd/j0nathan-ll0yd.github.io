// On-demand route: proxy /llms-full.txt from CloudFront.
// The backend composes the full data dump on every source-data change; this
// route ensures the path the llms.txt discovery index advertises resolves on
// jonathanlloyd.me, not only on the raw CloudFront host.

import {LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy} from '../lib/edge/proxy'
import {edgeRoute} from '../lib/edge/routes'

export const onRequest = makeCloudfrontProxy({
  path: LLM_CONTENT_PATHS.llmsFull,
  contentType: 'text/markdown; charset=utf-8',
  cachePolicy: LLM_OUTPUT_CACHE_POLICY
})

// On-demand: this route runs in the Worker on every request (atlas decision 0160, PR A).
export const prerender = false
export const ALL = edgeRoute(onRequest)
