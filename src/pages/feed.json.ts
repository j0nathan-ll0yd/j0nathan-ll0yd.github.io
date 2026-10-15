// On-demand route: proxy /feed.json from CloudFront. Gated like the llms trio, so every response is
// no-store (src/lib/edge/proxy.ts, atlas decision 0160 PR 0b).
// The backend (mantle-LifegamesPortal) owns the canonical JSON Feed 1.1.

import {feedArtifact} from '../lib/edge/feed-artifacts'
import {makeCloudfrontProxy} from '../lib/edge/proxy'
import {edgeRoute} from '../lib/edge/routes'

const {path, contentType} = feedArtifact('feed.json')

export const onRequest = makeCloudfrontProxy({path, contentType})

// On-demand: this route runs in the Worker on every request (atlas decision 0160, PR A).
export const prerender = false
export const ALL = edgeRoute(onRequest)
