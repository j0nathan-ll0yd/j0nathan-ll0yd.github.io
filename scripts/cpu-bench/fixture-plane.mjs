// A loopback fixture data plane for local profiling: focus.json and dashboard.json (composer.build
// rewritten to the local build id, composedAt rewritten to now, or once at start with STABLE=1 so the
// Worker's whole-text memo hits) with CloudFront's x-amz-cf-id stamp. No live data: pass a fixture.
// Usage: [STABLE=1] node scripts/cpu-bench/fixture-plane.mjs <port> <artifact.json> [build=dev] <focus.json>
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
const [, , port, artifactPath, build = 'dev', focusPath] = process.argv
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
const focus = readFileSync(focusPath, 'utf8')
const stableAt = process.env.STABLE ? new Date().toISOString() : null
createServer((req, res) => {
  const headers = {'content-type': 'application/json', 'x-amz-cf-id': 'local-fixture-plane', 'cache-control': 'no-store'}
  if (req.url.startsWith('/focus.json')) {
    res.writeHead(200, headers)
    res.end(focus)
    return
  }
  if (req.url.startsWith('/dashboard.json')) {
    const body = JSON.stringify({...artifact, composer: {build}, composedAt: stableAt ?? new Date().toISOString()})
    res.writeHead(200, {...headers, 'content-length': Buffer.byteLength(body)})
    res.end(body)
    return
  }
  res.writeHead(404, headers)
  res.end('{}')
}).listen(Number(port), '127.0.0.1',
  () => console.log(`fixture plane on 127.0.0.1:${port}, artifact ${artifactPath} (${Buffer.byteLength(JSON.stringify(artifact))} bytes), build ${build}`))
