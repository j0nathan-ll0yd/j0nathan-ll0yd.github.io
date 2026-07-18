// Pages Function: proxy /llms.txt from CloudFront with edge caching.
// The backend (mantle-LifegamesPortal) owns the canonical content.
//
// The /llms.txt discovery index has no dedicated contract path constant
// (LLM_CONTENT_PATHS covers llms-full / llms-small / index.md); the host is
// sourced from the contract inside the factory so no CloudFront literal is
// hardcoded here.

import { makeCloudfrontProxy } from './_lib/proxy';

export const onRequest = makeCloudfrontProxy({
  path: '/llms.txt',
  contentType: 'text/plain; charset=utf-8',
});
