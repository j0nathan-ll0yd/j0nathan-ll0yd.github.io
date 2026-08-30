// Pages Function: proxy /llms-full.txt from CloudFront.
// The backend composes the full data dump on every source-data change; this
// route ensures the path the llms.txt discovery index advertises resolves on
// jonathanlloyd.me, not only on the raw CloudFront host.

import {LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy} from './_lib/proxy'

export const onRequest = makeCloudfrontProxy({
  path: LLM_CONTENT_PATHS.llmsFull,
  contentType: 'text/markdown; charset=utf-8',
  cachePolicy: LLM_OUTPUT_CACHE_POLICY
})
