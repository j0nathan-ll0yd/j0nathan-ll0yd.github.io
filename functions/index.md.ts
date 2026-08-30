// Pages Function: proxy /index.md from CloudFront.
// index.md is the same-composition byte-identical alias of llms-full.txt (for agents
// expecting .md extensions); this route ensures it resolves on jonathanlloyd.me,
// not only on the raw CloudFront host.

import {LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy} from './_lib/proxy'

export const onRequest = makeCloudfrontProxy({
  path: LLM_CONTENT_PATHS.indexMarkdown,
  contentType: 'text/markdown; charset=utf-8',
  cachePolicy: LLM_OUTPUT_CACHE_POLICY
})
