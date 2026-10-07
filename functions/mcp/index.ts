// Pages Function: the read-only MCP server at /mcp. See functions/_lib/mcp-server.ts.

import {handleMcpRequest} from '../_lib/mcp-server'
import type {CloudfrontProxyContext} from '../_lib/proxy'

export const onRequest = (context: CloudfrontProxyContext): Promise<Response> => handleMcpRequest(context)
