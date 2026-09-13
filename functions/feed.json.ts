// Pages Function: proxy /feed.json from CloudFront with edge caching.
// The backend (mantle-LifegamesPortal) owns the canonical JSON Feed 1.1.

import {feedArtifact} from './_lib/feed-artifacts'
import {makeCloudfrontProxy} from './_lib/proxy'

const {path, contentType} = feedArtifact('feed.json')

export const onRequest = makeCloudfrontProxy({path, contentType})
