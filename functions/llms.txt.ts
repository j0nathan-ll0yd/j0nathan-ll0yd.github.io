// Pages Function: proxy /llms.txt from CloudFront.
// The backend (mantle-LifegamesPortal) owns the canonical content.

import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy} from './_lib/proxy'
import {LLMS_TXT_PATH} from './_lib/llms-artifacts'

export const onRequest = makeCloudfrontProxy({path: LLMS_TXT_PATH, contentType: 'text/plain; charset=utf-8', cachePolicy: LLM_OUTPUT_CACHE_POLICY})
