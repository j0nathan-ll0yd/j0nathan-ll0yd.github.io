// On-demand route: the read-only MCP server at /mcp (atlas decision 0158). See
// src/lib/edge/mcp-server.ts.

import {handleMcpRequest} from '../../lib/edge/mcp-server'
import type {CloudfrontProxyContext} from '../../lib/edge/proxy'
import {edgeRoute} from '../../lib/edge/routes'

export const onRequest = (context: CloudfrontProxyContext): Promise<Response> => handleMcpRequest(context)

// On-demand: this route runs in the Worker on every request (atlas decision 0160, PR A).
export const prerender = false
export const ALL = edgeRoute(onRequest)
