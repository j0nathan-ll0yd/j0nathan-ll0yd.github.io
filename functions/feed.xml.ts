// Pages Function: proxy /feed.xml from CloudFront with edge caching.
// The backend (mantle-LifegamesPortal) owns the canonical RSS 2.0 feed.

import { makeCloudfrontProxy } from './_lib/proxy';

export const onRequest = makeCloudfrontProxy({
  path: '/feed.xml',
  contentType: 'application/rss+xml; charset=utf-8',
});
