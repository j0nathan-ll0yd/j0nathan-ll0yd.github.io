// On-demand route: proxy /llms.txt from CloudFront.
// The backend (mantle-LifegamesPortal) owns the canonical content.

import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy} from '../lib/edge/proxy'
import {LLMS_TXT_PATH} from '../lib/edge/llms-artifacts'
import {edgeRoute} from '../lib/edge/routes'

export const onRequest = makeCloudfrontProxy({path: LLMS_TXT_PATH, contentType: 'text/plain; charset=utf-8', cachePolicy: LLM_OUTPUT_CACHE_POLICY})

// On-demand: this route runs in the Worker on every request (atlas decision 0160, PR A).
export const prerender = false
export const ALL = edgeRoute(onRequest)
