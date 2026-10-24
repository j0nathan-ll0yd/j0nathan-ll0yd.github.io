// On-demand route: the developer API facade at /api/v1/<export>.json (is-agentic api-v1 plan). See
// src/lib/edge/api-v1.ts.

import {env} from 'cloudflare:workers'
import {apiV1Env, handleApiV1} from '../../../lib/edge/api-v1'
import {edgeRoute} from '../../../lib/edge/routes'

// On-demand: this route runs in the Worker on every request. It answers every method itself.
export const prerender = false
export const ALL = edgeRoute((context) => handleApiV1(context, apiV1Env(env)))
