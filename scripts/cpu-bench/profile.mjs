// Profiles the local Worker (wrangler dev, workerd) over the DevTools protocol: a cold isolate's
// first `GET /`, then the same isolate warmed by N more requests. Writes .cpuprofile files and a
// per-function summary. Usage:
//   PLANE=http://127.0.0.1:8790 [PER_REQUEST=12] [OUT=/tmp/cpu-prof] node scripts/cpu-bench/profile.mjs <label> [warmRequests=50] [samplingUs=100] [extraWranglerArgs...]
// Needs the fixture plane (scripts/cpu-bench/fixture-plane.mjs) and a built dist/ (pnpm build). Run from the repo root.
// PER_REQUEST=n profiles each of the first n requests separately (the JIT progression).
// PUBLISH_BODY=<payload.json> POSTs that body to /_ssr/publish instead of GET / (a publish-time composition prototype).
import {spawn} from 'node:child_process'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {request as httpRequest} from 'node:http'
import {randomBytes} from 'node:crypto'
const [, , label = 'run', warmArg = '50', samplingArg = '100', ...extra] = process.argv
const WARM = Number(warmArg), SAMPLING_US = Number(samplingArg)
const PORT = 8798, INSPECTOR = 9240
const OUT = `${process.env.OUT ?? '/tmp/cpu-prof'}/${label}`
mkdirSync(OUT, {recursive: true})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function startWrangler() {
  const child = spawn('pnpm', [
    'exec',
    'wrangler',
    'dev',
    '--port',
    String(PORT),
    '--inspector-port',
    String(INSPECTOR),
    '--var',
    `DATA_PLANE_BASE:${process.env.PLANE ?? 'http://127.0.0.1:8790'}`,
    '--var',
    'SSR_FAULT_INJECTION:1',
    '--show-interactive-dev-session',
    'false',
    '--log-level',
    'warn',
    ...extra
  ], {stdio: ['ignore', 'pipe', 'pipe']})
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  return {child, log: () => log}
}
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    const url = await fetch(`http://127.0.0.1:${INSPECTOR}/json`).then(async (r) => (r.ok ? (await r.json())[0]?.webSocketDebuggerUrl : undefined), () =>
      undefined)
    if (url) {
      return url
    }
    await sleep(250)
  }
  throw new Error('inspector never came up')
}
/**
 * A minimal WebSocket client over an HTTP upgrade (text frames, client masking), because Node's own
 * WebSocket does not complete the inspector proxy's handshake. Enough for the DevTools protocol.
 */
class InspectorSocket {
  constructor(url) {
    this.url = new URL(url)
    this.buffer = Buffer.alloc(0)
    this.listeners = []
  }
  open() {
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        host: this.url.hostname,
        port: this.url.port,
        path: this.url.pathname,
        method: 'GET',
        headers: {Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64')}
      })
      req.on('upgrade', (_response, socket) => {
        this.socket = socket
        socket.on('data', (chunk) => this.receive(chunk))
        resolve()
      })
      req.on('response', (response) => reject(new Error(`upgrade refused: ${response.statusCode}`)))
      req.on('error', reject)
      req.end()
    })
  }
  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      if (this.buffer.length < 2) {
        return
      }
      let length = this.buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        if (this.buffer.length < 4) {
          return
        }
        length = this.buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (this.buffer.length < 10) {
          return
        }
        length = Number(this.buffer.readBigUInt64BE(2))
        offset = 10
      }
      if (this.buffer.length < offset + length) {
        return
      }
      const opcode = this.buffer[0] & 0x0f
      const payload = this.buffer.subarray(offset, offset + length)
      this.buffer = this.buffer.subarray(offset + length)
      if (opcode === 1) {
        for (const listener of this.listeners) {
          listener(payload.toString('utf8'))
        }
      }
    }
  }
  send(text) {
    const payload = Buffer.from(text, 'utf8')
    const mask = randomBytes(4)
    const header = payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : payload.length < 65536
      ? Buffer.concat([
        Buffer.from([0x81, 0x80 | 126]),
        (() => {
          const b = Buffer.alloc(2)
          b.writeUInt16BE(payload.length)
          return b
        })()
      ])
      : Buffer.concat([
        Buffer.from([0x81, 0x80 | 127]),
        (() => {
          const b = Buffer.alloc(8)
          b.writeBigUInt64BE(BigInt(payload.length))
          return b
        })()
      ])
    const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]))
    this.socket.write(Buffer.concat([header, mask, masked]))
  }
  close() {
    this.socket?.destroy()
  }
}

class Cdp {
  constructor(url) {
    this.ws = new InspectorSocket(url)
    this.id = 0
    this.pending = new Map()
    this.ws.listeners.push((data) => {
      const msg = JSON.parse(data)
      if (msg.id && this.pending.has(msg.id)) {
        const {resolve, reject} = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) {
          reject(new Error(JSON.stringify(msg.error)))
        } else {
          resolve(msg.result)
        }
      }
    })
  }
  open() {
    return this.ws.open()
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({id, method, params}))
    return new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}))
  }
  close() {
    this.ws.close()
  }
}
async function get(n) {
  const times = []
  const publish = process.env.PUBLISH_BODY
  const body = publish ? readFileSync(publish) : null
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    const r = publish
      ? await fetch(`http://127.0.0.1:${PORT}/_ssr/publish`, {method: 'POST', headers: {'content-type': 'application/json'}, body})
      : await fetch(`http://127.0.0.1:${PORT}/`, {headers: {accept: 'text/html'}})
    const text = await r.text()
    times.push(performance.now() - t)
    if (r.status !== 200 || (!publish && !['live', 'stale', 'partial'].includes(r.headers.get('x-ssr-data') ?? ''))) {
      throw new Error(`unexpected ${r.status} ${r.headers.get('x-ssr-data')} ${text.slice(0, 200)}`)
    }
  }
  return times
}
async function profile(cdp, name, requests) {
  await cdp.send('Profiler.start')
  const times = await get(requests)
  const {profile} = await cdp.send('Profiler.stop')
  writeFileSync(`${OUT}/${name}.cpuprofile`, JSON.stringify(profile))
  return {times, profile}
}
const w = startWrangler()
try {
  const wsUrl = await waitReady()
  // the inspector is up before the first request compiles anything: no request has run yet
  let cdp
  for (let i = 0;; i++) {
    cdp = new Cdp(wsUrl)
    try {
      await cdp.open()
      break
    } catch (error) {
      if (i >= 40) {
        throw error
      }
      await sleep(500)
    }
  }
  await cdp.send('Runtime.enable').catch(() => {})
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', {interval: SAMPLING_US})
  const PER = Number(process.env.PER_REQUEST ?? 0)
  const cold = PER > 0 ? await profile(cdp, 'req-1', 1) : await profile(cdp, 'cold-first', 1)
  for (let k = 2; k <= PER; k++) {
    await profile(cdp, `req-${k}`, 1)
  }
  const warm = WARM > 0 ? await profile(cdp, `warm-${WARM}`, WARM) : {times: [0]}
  const q = (a, p) => {
    const s = [...a].sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))]
  }
  console.log(
    JSON.stringify({
      label,
      coldWallMs: Number(cold.times[0].toFixed(1)),
      warmWallMs: {median: Number(q(warm.times, 50).toFixed(1)), p90: Number(q(warm.times, 90).toFixed(1)), min: Number(Math.min(...warm.times).toFixed(1))}
    })
  )
  cdp.close()
} finally {
  w.child.kill('SIGTERM')
  await sleep(500)
  w.child.kill('SIGKILL')
  if (/error/i.test(w.log())) {
    console.error(w.log().slice(-1500))
  }
}
