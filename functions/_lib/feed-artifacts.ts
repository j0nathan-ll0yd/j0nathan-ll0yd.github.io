// Shared registry for the syndication feed artifacts (/feed.xml, /feed.json).
//
// The same role functions/_lib/llms-artifacts.ts plays for the llm-outputs
// trio: ONE place that owns each artifact's path and content type, so the
// route file, the origin URL a probe fetches, and the URL the proxy actually
// fetches cannot drift apart. makeCloudfrontProxy builds its upstream as
// `${CLOUDFRONT_BASE}${path}` (functions/_lib/proxy.ts), and `originUrl` below
// is derived by that identical rule.
//
// Not itself a route: Pages Functions only creates routes for modules that
// export an onRequest* handler.

import {CLOUDFRONT_BASE, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'

const FEED_XML_PATH = '/feed.xml'
const FEED_JSON_PATH = '/feed.json'

export const FEED_ARTIFACTS = [
  {
    id: 'feed.xml',
    path: FEED_XML_PATH,
    originUrl: `${CLOUDFRONT_BASE}${FEED_XML_PATH}`,
    siteUrl: `${SITE_URL}${FEED_XML_PATH}`,
    contentType: 'application/rss+xml; charset=utf-8'
  },
  {
    id: 'feed.json',
    path: FEED_JSON_PATH,
    originUrl: `${CLOUDFRONT_BASE}${FEED_JSON_PATH}`,
    siteUrl: `${SITE_URL}${FEED_JSON_PATH}`,
    contentType: 'application/feed+json; charset=utf-8'
  }
] as const

export type FeedArtifact = (typeof FEED_ARTIFACTS)[number]
export type FeedArtifactId = FeedArtifact['id']

/**
 * S3 object metadata key carrying the composition timestamp, mirrored to the
 * client by CloudFront. It is the ONLY composition marker feed.json has: JSON
 * Feed 1.1 defines no build-date field, unlike RSS `<lastBuildDate>`. The same
 * key is declared by the llms-assurance contract
 * (layers.originComposition.timestampMetadata).
 *
 * Observable on the CLOUDFRONT ORIGIN plane only. The Pages Functions proxy
 * builds a fresh Response from a fixed header set and does not forward it, so
 * a site-plane observation can never read it.
 */
export const COMPOSED_AT_METADATA_HEADER = 'x-amz-meta-composed-at'

/** Looks one artifact up by id, throwing rather than returning undefined. */
export function feedArtifact(id: FeedArtifactId): FeedArtifact {
  const artifact = FEED_ARTIFACTS.find((candidate) => candidate.id === id)
  if (!artifact) {
    throw new Error(`FEED_ARTIFACTS has no artifact "${id}"`)
  }
  return artifact
}
