// Pages Function: proxy /feed.json from CloudFront with edge caching.
// The backend (mantle-LifegamesPortal) owns the canonical JSON Feed 1.1.

import { makeCloudfrontProxy } from './_lib/proxy';

export const onRequest = makeCloudfrontProxy({
  path: '/feed.json',
  contentType: 'application/feed+json; charset=utf-8',
});
