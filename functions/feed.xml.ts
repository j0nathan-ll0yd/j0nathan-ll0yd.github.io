// Pages Function: proxy /feed.xml from CloudFront with edge caching.
// The backend (mantle-LifegamesPortal) owns the canonical RSS 2.0 feed.

import {feedArtifact} from './_lib/feed-artifacts'
import {makeCloudfrontProxy} from './_lib/proxy'

const {path, contentType} = feedArtifact('feed.xml')

export const onRequest = makeCloudfrontProxy({path, contentType})
