// scripts/rollback-route.sh deletes the Workers Route jonathanlloyd.me/* to roll production back to the
// Pages project (atlas decisions 0160 PR A and 0162 item 14). The stand-ins in
// tests/unit/fixtures/rollback-route/ come first on PATH: curl (the API and the apex), pnpm (the
// wrangler login that --execute and --check-login read, owner decisions 2026-10-20 and 2026-10-21)
// and a node wrapper that records node's argv, helper mode and environment. Each case runs the real
// script with no network call, from a scratch directory outside the repository. The cases pin what
// the rollback depends on: zero or two matching routes refuse, the dry run uses the read-only token
// and sends no DELETE, --execute takes its token from the wrangler login only and fails closed
// without one, sends exactly one DELETE for the one matching id, then reads the routes back and
// checks that Pages answers the apex, --check-login reads the same login and makes no API call, and
// no token reaches an argv, the output or a child. The stand-ins are separate from the script's own
// --self-test stubs, so this gate does not rest on the script's test code.
import {spawnSync} from 'node:child_process'
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest'

const SCRIPT = path.resolve('scripts/rollback-route.sh')
const REPO_ROOT = realpathSync(path.resolve('.'))
const STUB_BIN = path.resolve('tests/unit/fixtures/rollback-route')
// --env-file /dev/null: wrangler would otherwise load the repository's .env files into its environment.
const WRANGLER_CALL = `--dir ${REPO_ROOT} exec wrangler auth token --json --env-file /dev/null`
// The zone the script defaults to: jonathanlloyd.me (atlas decision 0162, item 3 evidence, row L2).
const DEFAULT_ZONE = '4d14ef06a76b6f09918d27d3cca0a9c3'
const routesUrl = (zone: string) => `https://api.cloudflare.com/client/v4/zones/${zone}/workers/routes`
const APEX = 'https://jonathanlloyd.me/version.json'
const PAGES_BUILD = 'c9fc69f551bfd85eb64ccc39d3c5d4dc1e259e11'
// The D7 runbook is in the atlas repository, so each pointer to it names the repository, the path and the PR.
const D7_RUNBOOK = 'atlas decisions/evidence/0162-open-items/item-03-d7-runbook.md (atlas PR #457)'
// The dry run's read-only token, and the token that the pnpm stand-in answers as the wrangler login.
const TOKEN = 'unit-test-token-not-a-credential'
const LOGIN_TOKEN = 'unit-test-login-token-not-a-credential'
// --execute and --check-login runs default to a zone that does not exist: a second barrier, after the
// stand-in guard below, between this suite and the real route on a machine that holds a real wrangler
// login.
const EXECUTE_ZONE = '00000000000000000000000000000000'

type Route = {id: string; pattern: string; script?: string; request_limit_fail_open?: boolean}
// Synthetic ids: no fixture names the live route.
const MATCH: Route = {id: 'feedfacecafebeef0123456789abcdef', pattern: 'jonathanlloyd.me/*', script: 'human-datastream', request_limit_fail_open: true}
const TWIN: Route = {...MATCH, id: '00112233445566778899aabbccddeeff', request_limit_fail_open: false}
// The right pattern for another script, the right script on another pattern, and a route with no script.
const NEAR_MISSES: Route[] = [
  {id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', pattern: 'jonathanlloyd.me/*', script: 'pr-a-rehearsal'},
  {id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', pattern: 'pr-a-rehearsal.jonathanlloyd.me/*', script: 'human-datastream'},
  {id: 'cccccccccccccccccccccccccccccccc', pattern: 'jonathanlloyd.me/static/*'}
]

// The script must run the stand-ins: on a machine with a real wrangler login, the real pnpm would hand
// it a real token. No case runs unless curl, pnpm and node resolve to the stand-ins first.
beforeAll(() => {
  for (const tool of ['curl', 'pnpm', 'node']) {
    const found = spawnSync('bash', ['-c', `command -v ${tool}`], {env: {...process.env, PATH: `${STUB_BIN}:${process.env.PATH}`}, encoding: 'utf8'})
    expect(found.stdout.trim(), `${tool} must resolve to the stand-in`).toBe(path.join(STUB_BIN, tool))
  }
})

let scratch = ''
beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'rollback-route-'))
})
afterEach(() => rmSync(scratch, {recursive: true, force: true}))

const envelope = (result: Route[]) => JSON.stringify({success: true, errors: [], messages: [], result})

/** Serves `routes` to every list call, and `after` to a list call once the route is gone. */
function serve(routes: Route[], after: Route[] = routes.filter((route) => route !== MATCH)): void {
  writeFileSync(path.join(scratch, 'routes.json'), envelope(routes))
  writeFileSync(path.join(scratch, 'routes-after.json'), envelope(after))
}

/**
 * Runs the script from the scratch directory. An `undefined` value removes the variable. The curl
 * stand-in accepts the read-only token on a dry run and the login token on the two login modes.
 */
function run(args: string[], overrides: Record<string, string | undefined> = {}, shell: string[] = ['bash']) {
  const login = args.includes('--execute') || args.includes('--check-login')
  const merged: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${STUB_BIN}:${process.env.PATH}`,
    STUB_DIR: scratch,
    STUB_TOKEN: login ? LOGIN_TOKEN : TOKEN,
    STUB_LOGIN_TOKEN: LOGIN_TOKEN,
    STUB_SECRETS: `${TOKEN} ${LOGIN_TOKEN}`,
    STUB_REAL_NODE: process.execPath,
    CLOUDFLARE_API_TOKEN: TOKEN,
    CLOUDFLARE_ZONE_ID: login ? EXECUTE_ZONE : undefined,
    ROLLBACK_ROUTE_WAIT_SECONDS: '0',
    ...overrides
  }
  const env = Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const [command, ...flags] = shell
  const result = spawnSync(command, [...flags, SCRIPT, ...args], {cwd: scratch, env, encoding: 'utf8'})
  return {status: result.status, stdout: result.stdout, stderr: result.stderr}
}

/** The non-empty lines of a stand-in log. */
function lines(name: string): string[] {
  const file = path.join(scratch, name)
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []
}

/** Every call the stand-in saw, in order. */
function calls(): {auth: string; method: string; url: string}[] {
  return lines('calls.log').map((line) => {
    const [auth, method, url] = line.split('\t')
    return {auth, method, url}
  })
}

/** The calls in short form: API calls by method, the apex check as APEX, each with how it authenticated. */
function sequence(): string[] {
  return calls().map(({auth, method, url}) => {
    if (url.startsWith(`${APEX}?`)) {
      return `APEX:${auth}`
    }
    if (method === 'DELETE') {
      return `DELETE:${url.slice(url.lastIndexOf('/') + 1)}:${auth}`
    }
    return `${method}:${auth}`
  })
}

const FULL_RUN = ['GET:ok', `DELETE:${MATCH.id}:ok`, 'GET:ok', 'APEX:none']

describe('rollback-route.sh refuses unless exactly one route matches', () => {
  it.each([[[]], [['--execute']]])('no matching route: exit 3, no DELETE, and the three causes (args %j)', (args) => {
    serve(NEAR_MISSES)
    const {status, stderr} = run(args)
    expect(status).toBe(3)
    expect(sequence()).toEqual(['GET:ok', 'APEX:none'])
    expect(stderr).toContain('refusing: no route has pattern jonathanlloyd.me/* and script human-datastream')
    expect(stderr).toContain('The apex answers now: worker build')
    expect(stderr).toContain('This rollback already ran.')
    const zone = args.includes('--execute') ? `${EXECUTE_ZONE} (from CLOUDFLARE_ZONE_ID)` : `${DEFAULT_ZONE} (the default)`
    expect(stderr).toContain(`This run read zone ${zone}.`)
    expect(stderr).toContain('D7 has run (decision 0162 item 3)')
    expect(stderr).toContain('env -u CLOUDFLARE_API_TOKEN pnpm exec wrangler rollback [version-id] --name human-datastream')
  })

  it.each([[[]], [['--execute']]])('two matching routes: exit 3 and no DELETE (args %j)', (args) => {
    serve([MATCH, TWIN, ...NEAR_MISSES])
    const {status, stderr} = run(args)
    expect(status).toBe(3)
    expect(sequence()).toEqual(['GET:ok'])
    expect(stderr).toContain('refusing: 2 routes have pattern jonathanlloyd.me/* and script human-datastream')
  })

  it('refuses a matching route whose id could change the DELETE path', () => {
    serve([{...MATCH, id: '../../../accounts/x'}])
    expect(run(['--execute']).status).toBe(3)
    expect(sequence()).toEqual(['GET:ok'])
  })
})

describe('rollback-route.sh dry run', () => {
  it('sends one GET to the default zone and no DELETE, and names the route it would delete', () => {
    serve([MATCH, ...NEAR_MISSES])
    const {status, stdout} = run([])
    expect(status).toBe(0)
    expect(calls()).toEqual([{auth: 'ok', method: 'GET', url: routesUrl(DEFAULT_ZONE)}])
    expect(stdout).toContain(`zone ${DEFAULT_ZONE} (the default)`)
    expect(stdout).toContain(`match ${MATCH.id}  jonathanlloyd.me/* -> human-datastream  request_limit_fail_open=true`)
    expect(stdout).toContain(`Dry run: nothing changed. To delete route ${MATCH.id}`)
  })

  it('prints what the rollback does: the frozen Pages build, the clear address, the D7 end, the safer Worker rollback', () => {
    serve([MATCH])
    const {stdout} = run([])
    expect(stdout).toContain('returns to the Pages project')
    expect(stdout).toContain('frozen build c9fc69f5')
    expect(stdout).toContain('the data-free dashboard, and /privacy')
    expect(stdout).toContain('with the contact address in clear')
    expect(stdout).toContain('It ends at D7.')
    expect(stdout).toContain(`Undo the attach first, with Step 2 (d) of the D7 runbook:\n    ${D7_RUNBOOK}.`)
    expect(stdout).toContain('env -u CLOUDFLARE_API_TOKEN pnpm exec wrangler rollback [version-id] --name human-datastream')
  })
})

describe('rollback-route.sh --execute', () => {
  it('sends exactly one DELETE, for the matching id, reads the routes back, then sees Pages on the apex', () => {
    serve([MATCH, ...NEAR_MISSES])
    const {status, stdout} = run(['--execute'])
    expect(status).toBe(0)
    expect(sequence()).toEqual(FULL_RUN)
    expect(calls()[1].url).toBe(`${routesUrl(EXECUTE_ZONE)}/${MATCH.id}`)
    expect(stdout).toContain(`Done: Pages answers the apex (pages build ${PAGES_BUILD}).`)
  })

  it('prints what the rollback does before it sends the DELETE', () => {
    serve([MATCH])
    const {stdout} = run(['--execute'])
    const explained = stdout.indexOf('What --execute does:')
    expect(explained).toBeGreaterThan(-1)
    expect(stdout.indexOf(`sending DELETE /zones/${EXECUTE_ZONE}/workers/routes/${MATCH.id}`)).toBeGreaterThan(explained)
  })

  it('asks the apex with no token, past any cache', () => {
    serve([MATCH])
    run(['--execute'])
    const apex = calls()[3]
    expect(apex.auth).toBe('none')
    expect(apex.url).toMatch(/^https:\/\/jonathanlloyd\.me\/version\.json\?rollback-check=\d+$/)
  })
})

describe('rollback-route.sh --execute reads the routes back whatever the DELETE answered', () => {
  it('a refused DELETE leaves the route: exit 1, nothing changed, the permission named', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_DELETE_STATUS: '403'})
    expect(status).toBe(1)
    expect(sequence()).toEqual(FULL_RUN.slice(0, 3))
    expect(stderr).toContain('the DELETE is not confirmed: HTTP 403 (errors: 10000: Authentication error).')
    expect(stderr).toContain('A 403 usually means that the token is malformed or lacks a permission')
    expect(stderr).toContain('the route is still there, so nothing changed.')
  })

  it('a DELETE that answers 502 but takes effect: exit 0, with a warning', () => {
    serve([MATCH])
    const {status, stdout, stderr} = run(['--execute'], {STUB_DELETE_STATUS: '502', STUB_DELETE_APPLIES: '1'})
    expect(status).toBe(0)
    expect(sequence()).toEqual(FULL_RUN)
    expect(stderr).toContain('the DELETE is not confirmed: HTTP 502')
    expect(stderr).toContain('the DELETE answer was unexpected, but the read-back lists no matching route, so the route is gone.')
    expect(stdout).toContain('Done: Pages answers the apex')
  })

  it('a DELETE answer that names another id is not a confirmation', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_DELETE_RESULT_ID: 'ffffffffffffffffffffffffffffffff'})
    expect(status).toBe(0)
    expect(stderr).toContain(`the DELETE is not confirmed: the DELETE answer names id ffffffffffffffffffffffffffffffff, not ${MATCH.id}`)
  })

  it('a 200 DELETE answer with success false leaves the route: exit 1', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_DELETE_SUCCESS: 'false'})
    expect(status).toBe(1)
    expect(sequence()).toEqual(FULL_RUN.slice(0, 3))
    expect(stderr).toContain('the DELETE is not confirmed: the API answer has success false')
    expect(stderr).toContain('the route is still there, so nothing changed.')
  })

  it('a DELETE transport failure with the route still listed: exit 1, nothing changed', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_DELETE_EXIT: '28'})
    expect(status).toBe(1)
    expect(sequence()).toEqual(FULL_RUN.slice(0, 3))
    expect(stderr).toContain('the DELETE is not confirmed: curl failed (see above)')
    expect(stderr).toContain('the route is still there, so nothing changed.')
  })

  it('a DELETE transport failure and a failed read-back: exit 4, state unknown', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_DELETE_EXIT: '28', STUB_READBACK_STATUS: '500'})
    expect(status).toBe(4)
    expect(sequence()).toEqual(FULL_RUN.slice(0, 3))
    expect(stderr).toContain('the DELETE is not confirmed and the read-back failed, so the route state is unknown.')
  })

  it('a confirmed DELETE and a failed read-back: exit 4, very likely gone', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_READBACK_EXIT: '28'})
    expect(status).toBe(4)
    expect(sequence()).toEqual(FULL_RUN.slice(0, 3))
    expect(stderr).toContain('the API confirmed the DELETE, but the read-back failed, so the route is very likely gone.')
  })

  it('a confirmed DELETE that the read-back contradicts: exit 1, and no second DELETE', () => {
    serve([MATCH], [MATCH])
    const {status, stderr} = run(['--execute'])
    expect(status).toBe(1)
    expect(sequence()).toEqual(FULL_RUN.slice(0, 3))
    expect(stderr).toContain('the API confirmed the DELETE, but the read-back still lists 1 matching route(s).')
  })
})

describe('rollback-route.sh --execute checks that Pages answers the apex', () => {
  it('exit 5 when the Worker still answers, as after a D7 attach', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_APEX_AFTER: 'worker'})
    expect(status).toBe(5)
    expect(sequence()).toEqual(FULL_RUN)
    expect(stderr).toContain('the route is gone, but the Worker still answers the apex (worker build')
    expect(stderr).toContain(`Undo the attach first, with Step 2 (d) of the D7 runbook:\n  ${D7_RUNBOOK}.`)
  })

  it('exit 5 when the apex answers an error, which a missing marker header cannot tell from Pages', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_APEX_AFTER: 'error'})
    expect(status).toBe(5)
    expect(stderr).toContain('the route is gone, but the apex answers with an error (error HTTP 522).')
  })

  it('probes again every 2 s within ROLLBACK_ROUTE_WAIT_SECONDS', () => {
    serve([MATCH])
    const {status} = run(['--execute'], {STUB_APEX_AFTER: 'worker', ROLLBACK_ROUTE_WAIT_SECONDS: '2'})
    expect(status).toBe(5)
    expect(sequence()).toEqual([...FULL_RUN, 'APEX:none'])
  }, 30_000)

  // A probe may take only the time left before the deadline, so a slow apex cannot stretch the wait.
  // With a 5 s wait the time left is 1 to 5 s, depending on how long the run takes to reach the probe;
  // a probe that ignored it would get the default 10 s.
  it.each([
    ['0', /--max-time 1 /],
    ['5', /--max-time [1-5] /],
    ['30', /--max-time 10 /]
  ])('with a wait of %s s, the apex probe gets the time left (%s)', (wait, maxTime) => {
    serve([MATCH])
    expect(run(['--execute'], {ROLLBACK_ROUTE_WAIT_SECONDS: wait}).status).toBe(0)
    const probes = lines('argv.log').filter((line) => line.includes(`${APEX}?`))
    expect(probes).toHaveLength(1)
    expect(probes[0]).toMatch(maxTime)
  })
})

describe('rollback-route.sh inputs and failures', () => {
  it('stops before any DELETE when the route list is refused', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {STUB_LIST_STATUS: '403'})
    expect(status).toBe(1)
    expect(sequence()).toEqual(['GET:ok'])
    expect(stderr).toContain('HTTP 403 (errors: 10000: Authentication error).')
  })

  it.each([
    ['an unsuccessful envelope', JSON.stringify({success: false, errors: [{code: 7003, message: 'gone'}], messages: [], result: null}), '7003: gone'],
    ['a body that is not JSON', '<html>error code: 1020</html>', 'the API answer is not a JSON object'],
    ['an envelope with no result array', JSON.stringify({success: true, errors: [], messages: [], result: {}}), 'the API answer has no result array']
  ])('stops before any DELETE on %s', (_name, body, message) => {
    writeFileSync(path.join(scratch, 'routes.json'), body)
    const {status, stderr} = run(['--execute'])
    expect(status).toBe(1)
    expect(sequence()).toEqual(['GET:ok'])
    expect(stderr).toContain(message)
  })

  it('the dry run needs CLOUDFLARE_API_TOKEN, names the read-only token, and sends nothing without it', () => {
    serve([MATCH])
    const {status, stderr} = run([], {CLOUDFLARE_API_TOKEN: undefined})
    expect(status).toBe(2)
    expect(calls()).toEqual([])
    expect(stderr).toContain(
      'CLOUDFLARE_API_TOKEN is not set. The dry run reads the routes with the read-only token: CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ACCOUNT_READALL"'
    )
  })

  it('the dry run refuses a token that could inject a header, and sends nothing', () => {
    serve([MATCH])
    const {status, stderr} = run([], {CLOUDFLARE_API_TOKEN: `${TOKEN}\nX-Injected: 1`})
    expect(status).toBe(2)
    expect(calls()).toEqual([])
    expect(stderr).toContain('CLOUDFLARE_API_TOKEN holds whitespace or a control character.')
  })

  it('takes CLOUDFLARE_ZONE_ID and says so, and refuses a value that is not a zone id', () => {
    serve([MATCH])
    const zone = '0123456789abcdef0123456789abcdef'
    const {status, stdout} = run([], {CLOUDFLARE_ZONE_ID: zone})
    expect(status).toBe(0)
    expect(stdout).toContain(`zone ${zone} (from CLOUDFLARE_ZONE_ID)`)
    expect(calls().map((call) => call.url)).toEqual([routesUrl(zone)])

    rmSync(path.join(scratch, 'calls.log'))
    expect(run(['--execute'], {CLOUDFLARE_ZONE_ID: '../../accounts/x'}).status).toBe(2)
    expect(calls()).toEqual([])
  })

  // 18446744073709551617 is 2^64 + 1: shell arithmetic wraps it to 1, so only the length bound refuses it.
  it.each(['soon', '601', '99999999999999999999', '18446744073709551617'])('refuses a wait of %s, before any call', (wait) => {
    serve([MATCH])
    expect(run(['--execute'], {ROLLBACK_ROUTE_WAIT_SECONDS: wait}).status).toBe(2)
    expect(calls()).toEqual([])
  })

  it('reads a wait with a leading zero as decimal, not octal', () => {
    serve([MATCH])
    const {status, stdout} = run(['--execute'], {ROLLBACK_ROUTE_WAIT_SECONDS: '09'})
    expect(status).toBe(0)
    expect(sequence()).toEqual(FULL_RUN)
    expect(stdout).toContain('Waiting up to about 9 s')
  })

  it('refuses an unknown or a second argument with exit 2', () => {
    serve([MATCH])
    expect(run(['--force']).status).toBe(2)
    expect(run(['--execute', '--execute']).status).toBe(2)
    expect(calls()).toEqual([])
  })
})

/** Every argv the stand-ins recorded (curl, pnpm and node), one per line. */
const allArgv = () => [...lines('argv.log'), ...lines('pnpm.log'), ...lines('node-argv.log')].join('\n')

describe('rollback-route.sh keeps the tokens out of sight', () => {
  it.each([[[]], [['--execute']]])(
    'sends the token on stdin to every API call and never to the apex, with --disable first, and no token in an argv, the output or a child (args %j)',
    (args) => {
      serve([MATCH])
      const {status, stdout, stderr} = run(args)
      expect(status).toBe(0)
      expect(sequence()).toEqual(args.length ? FULL_RUN : ['GET:ok'])
      expect(lines('node-argv.log').length).toBeGreaterThan(0)
      for (const token of [TOKEN, LOGIN_TOKEN]) {
        expect(allArgv()).not.toContain(token)
        expect(stdout + stderr).not.toContain(token)
      }
      // --disable must be the first argument: it stops curl from reading ~/.curlrc, where --verbose would print the header.
      expect(lines('first.log').every((first) => first === '--disable')).toBe(true)
      expect(lines('env.log')).toEqual([])
      expect(lines('node-env.log')).toEqual([])
    }
  )

  // bash also exports a function's `local answer` when the caller exported answer, and login_token
  // keeps wrangler's raw answer, token included, in that local.
  it.each(['API_TOKEN', 'answer'])('keeps the token from children even when the shell already exports %s', (name) => {
    serve([MATCH])
    expect(run(['--execute'], {[name]: 'exported-by-another-tool'}).status).toBe(0)
    expect(lines('env.log')).toEqual([])
    expect(lines('node-env.log')).toEqual([])
  })

  it.each([
    ['curl', 'command curl "$@"'],
    ['printf', 'builtin printf "$@"'],
    ['pnpm', 'command pnpm "$@"']
  ])('drops an exported %s function, which would otherwise run in place of the real command', (name, passThrough) => {
    serve([MATCH])
    const hijack = path.join(scratch, 'hijack.log')
    const {status} = run(['--execute'], {[`BASH_FUNC_${name}%%`]: `() { echo hijacked >> '${hijack}'; ${passThrough}; }`})
    expect(status).toBe(0)
    expect(existsSync(hijack)).toBe(false)
  })

  it('drops an inherited function whose name starts with a dash, which `unset -f` would read as an option', () => {
    serve([MATCH])
    expect(run([], {'BASH_FUNC_-x%%': '() { :; }'}).status).toBe(0)
  })

  it('turns a bash -x trace off before the token is read', () => {
    serve([MATCH])
    const {status, stderr} = run([], {}, ['bash', '-x'])
    expect(status).toBe(0)
    expect(stderr).toContain('tracing is off in this script, because a trace would print the token.')
    expect(stderr).not.toContain(TOKEN)
  })
})

// The cause that each login failure names, and the fix that follows it, for --execute and
// --check-login alike.
const exited = (status: number) => `wrangler auth token exited ${status}: the login is missing or expired, or wrangler failed`
const MISSING = exited(1)
const ENVIRONMENT = 'wrangler answered a credential from the environment, not the wrangler login'
const NOT_JSON = 'wrangler printed something other than its JSON answer'
const NO_TOKEN = 'the wrangler answer held no usable token'
const FIX = `Check the wrangler login with pnpm exec wrangler whoami, and log in again with pnpm exec wrangler login; run both from ${REPO_ROOT}.`

// Owner decision 2026-10-20: --execute takes its token from the wrangler login, through the repository's
// pinned wrangler (`pnpm exec wrangler auth token --json`), and the dry run keeps the read-only token.
describe('rollback-route.sh --execute takes its token from the wrangler login', () => {
  it('asks the repository wrangler once, with every credential variable cleared and the disk log, metrics and debug level off', () => {
    serve([MATCH])
    const credentials = {
      CF_API_TOKEN: TOKEN,
      CLOUDFLARE_API_KEY: 'key',
      CF_API_KEY: 'key',
      CLOUDFLARE_EMAIL: 'a@example.invalid',
      CF_EMAIL: 'a@example.invalid'
    }
    const {status} = run(['--execute'], {...credentials, WRANGLER_LOG: 'debug', WRANGLER_WRITE_LOGS: 'true', WRANGLER_SEND_METRICS: 'true'})
    expect(status).toBe(0)
    expect(lines('pnpm.log')).toEqual([WRANGLER_CALL])
    expect(lines('pnpm-env.log')).toEqual([])
  })

  it('uses the login token for every API call and ignores CLOUDFLARE_API_TOKEN', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'])
    expect(status).toBe(0)
    expect(sequence()).toEqual(FULL_RUN)
    expect(stderr).toContain('--execute ignores CLOUDFLARE_API_TOKEN; it uses the wrangler login.')
  })

  it('needs no CLOUDFLARE_API_TOKEN', () => {
    serve([MATCH])
    const {status, stderr} = run(['--execute'], {CLOUDFLARE_API_TOKEN: undefined})
    expect(status).toBe(0)
    expect(sequence()).toEqual(FULL_RUN)
    expect(stderr).not.toContain('ignores CLOUDFLARE_API_TOKEN')
  })

  it.each([
    ['no login', 'missing', MISSING, null],
    ['an expired login that wrangler cannot refresh', 'expired', MISSING, null],
    ['an environment token in place of the login', 'api_token', ENVIRONMENT, 'answered type api_token, not oauth'],
    ['an environment API key in place of the login', 'api_key', ENVIRONMENT, 'answered type api_key, not oauth'],
    ['an answer that is not JSON', 'not-json', NOT_JSON, 'answered type unknown, not oauth'],
    ['a line on stdout before the JSON', 'noisy', NOT_JSON, 'answered type unknown, not oauth'],
    ['an oauth answer with no token', 'no-token', NO_TOKEN, 'answered no usable token'],
    ['a token that could inject a header', 'bad-token', NO_TOKEN, 'answered no usable token'],
    ['a wrangler that fails another way', 'broken', exited(7), null]
  ])('fails closed on %s: exit 2 before any API call, with its cause and the fix', (_name, login, cause, detail) => {
    serve([MATCH])
    const {status, stdout, stderr} = run(['--execute'], {STUB_LOGIN: login})
    expect(status).toBe(2)
    expect(calls()).toEqual([])
    expect(lines('pnpm.log')).toEqual([WRANGLER_CALL])
    expect(stderr).toContain('reading the token of the wrangler login')
    expect(stderr).toContain(`${cause}, so --execute has no credential and sent nothing.`)
    if (detail) {
      expect(stderr).toContain(detail)
    }
    expect(stderr).toContain(FIX)
    expect(stdout + stderr).not.toContain(LOGIN_TOKEN)
    expect(lines('node-env.log')).toEqual([])
  })

  it('names a crashed token helper by its status, not as a missing token', () => {
    serve([MATCH])
    const {status, stdout, stderr} = run(['--execute'], {STUB_NODE_CRASH: '1'})
    expect(status).toBe(2)
    expect(calls()).toEqual([])
    expect(stderr).toContain('the token helper failed with status 1, so --execute has no credential and sent nothing.')
    expect(stdout + stderr).not.toContain(LOGIN_TOKEN)
  })

  it('the dry run never asks wrangler', () => {
    serve([MATCH])
    expect(run([]).status).toBe(0)
    expect(lines('pnpm.log')).toEqual([])
  })

  it('a copy outside the repository refuses --execute and --check-login before wrangler and before any API call, and still dry-runs', () => {
    serve([MATCH])
    mkdirSync(path.join(scratch, 'scripts'))
    const copy = path.join(scratch, 'scripts', 'rollback-route.sh')
    copyFileSync(SCRIPT, copy)
    const env = {
      ...process.env,
      PATH: `${STUB_BIN}:${process.env.PATH}`,
      STUB_DIR: scratch,
      STUB_TOKEN: TOKEN,
      STUB_SECRETS: TOKEN,
      STUB_REAL_NODE: process.execPath,
      CLOUDFLARE_ZONE_ID: EXECUTE_ZONE
    }
    const refused = spawnSync('bash', [copy, '--execute'], {cwd: scratch, env, encoding: 'utf8'})
    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain("reading the wrangler login needs the repository's pinned wrangler")
    expect(calls()).toEqual([])
    expect(lines('pnpm.log')).toEqual([])
    const checked = spawnSync('bash', [copy, '--check-login'], {cwd: scratch, env, encoding: 'utf8'})
    expect(checked.status).toBe(2)
    expect(checked.stderr).toContain("reading the wrangler login needs the repository's pinned wrangler")
    expect(calls()).toEqual([])
    expect(lines('pnpm.log')).toEqual([])
    const dry = spawnSync('bash', [copy], {cwd: scratch, env: {...env, CLOUDFLARE_API_TOKEN: TOKEN}, encoding: 'utf8'})
    expect(dry.status).toBe(0)
    const selfTest = spawnSync('bash', [copy, '--self-test'], {cwd: scratch, encoding: 'utf8'})
    expect(selfTest.status).toBe(1)
    expect(selfTest.stderr).toContain("the --execute and --check-login cases need the repository's node_modules: run pnpm install")
  })
})

// Owner decision 2026-10-21: --check-login reads the login token exactly as --execute does and prints OK
// or NOT OK, with no Cloudflare API call.
describe('rollback-route.sh --check-login', () => {
  it('says OK for an oauth answer, after the same wrangler call as --execute, with no API call', () => {
    const {status, stdout, stderr} = run(['--check-login'])
    expect(status).toBe(0)
    expect(stdout).toBe('wrangler login: OK (the answer is an oauth token; no Cloudflare API call was made)\n')
    expect(calls()).toEqual([])
    expect(lines('pnpm.log')).toEqual([WRANGLER_CALL])
    expect(lines('pnpm-env.log')).toEqual([])
    expect(lines('node-mode.log')).toEqual(['oauth-token'])
    expect(lines('node-env.log')).toEqual([])
    for (const token of [TOKEN, LOGIN_TOKEN]) {
      expect(allArgv()).not.toContain(token)
      expect(stdout + stderr).not.toContain(token)
    }
  })

  it.each([
    ['missing', MISSING],
    ['expired', MISSING],
    ['api_token', ENVIRONMENT],
    ['api_key', ENVIRONMENT],
    ['not-json', NOT_JSON],
    ['noisy', NOT_JSON],
    ['no-token', NO_TOKEN],
    ['bad-token', NO_TOKEN],
    ['broken', exited(7)]
  ])('says NOT OK on the %s login outcome, with the cause and the fix, and makes no API call', (login, cause) => {
    const {status, stdout, stderr} = run(['--check-login'], {STUB_LOGIN: login})
    expect(status).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain(`wrangler login: NOT OK: ${cause}.\n${FIX}\n`)
    expect(stderr).not.toContain('--execute')
    expect(calls()).toEqual([])
    expect(lines('pnpm.log')).toEqual([WRANGLER_CALL])
    // When wrangler fails, the token helper never runs; otherwise it runs once.
    expect(lines('node-mode.log')).toEqual(['missing', 'expired', 'broken'].includes(login) ? [] : ['oauth-token'])
    expect(lines('node-env.log')).toEqual([])
    for (const token of [TOKEN, LOGIN_TOKEN]) {
      expect(allArgv()).not.toContain(token)
      expect(stdout + stderr).not.toContain(token)
    }
  })

  it('says NOT OK when the token helper crashes', () => {
    const {status, stdout, stderr} = run(['--check-login'], {STUB_NODE_CRASH: '1'})
    expect(status).toBe(2)
    expect(stdout).toBe('')
    expect(stderr).toContain(`wrangler login: NOT OK: the token helper failed with status 1.\n${FIX}\n`)
    expect(calls()).toEqual([])
    expect(lines('node-mode.log')).toEqual(['oauth-token'])
    expect(lines('node-env.log')).toEqual([])
    for (const token of [TOKEN, LOGIN_TOKEN]) {
      expect(allArgv()).not.toContain(token)
      expect(stdout + stderr).not.toContain(token)
    }
  })

  it('keeps the token from the token helper even when the shell exports answer', () => {
    const {status} = run(['--check-login'], {answer: 'exported-by-another-tool'})
    expect(status).toBe(0)
    expect(lines('node-mode.log')).toEqual(['oauth-token'])
    expect(lines('node-env.log')).toEqual([])
  })

  it('needs no CLOUDFLARE_API_TOKEN and no zone, and the dry-run path never runs', () => {
    const {status} = run(['--check-login'], {CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ZONE_ID: 'not-a-zone'})
    expect(status).toBe(0)
    expect(calls()).toEqual([])
    expect(lines('node-mode.log')).toEqual(['oauth-token'])
    expect(lines('node-env.log')).toEqual([])
  })

  it('is in --help, with what OK proves and the refresh it can cause', () => {
    const {status, stdout} = run(['--help'])
    expect(status).toBe(0)
    const help = stdout.replace(/\s+/g, ' ')
    expect(help).toContain('[--execute | --check-login | --self-test | --help]')
    expect(help).toContain("OK means that wrangler holds an oauth token; it does not prove the token's scopes, or that the API accepts it.")
    expect(help).toContain("It can refresh an expired login: a POST to Cloudflare's OAuth endpoint and a write to wrangler's own credential store.")
  })
})

/** The bash on PATH, by its path: the cases below run with a PATH that holds no bash. */
const BASH = spawnSync('bash', ['-c', 'printf %s "$BASH"'], {encoding: 'utf8'}).stdout

/**
 * A PATH that holds only dirname (the script finds its own directory with it) and the stand-ins
 * other than `missing`, so the script cannot find the missing tool, whatever this machine holds.
 */
function pathWithout(missing: string): string {
  const bin = path.join(scratch, `bin-without-${missing}`)
  mkdirSync(bin)
  symlinkSync(spawnSync('bash', ['-c', 'command -v dirname'], {encoding: 'utf8'}).stdout.trim(), path.join(bin, 'dirname'))
  for (const tool of ['curl', 'node', 'pnpm'].filter((tool) => tool !== missing)) {
    symlinkSync(path.join(STUB_BIN, tool), path.join(bin, tool))
  }
  return bin
}

describe('rollback-route.sh stops before wrangler when a tool it needs is missing', () => {
  it('--check-login without node: exit 1, before wrangler and before any API call', () => {
    const {status, stderr} = run(['--check-login'], {PATH: pathWithout('node')}, [BASH])
    expect(status).toBe(1)
    expect(stderr).toContain('node is not on PATH (the script reads the wrangler answer with it).')
    expect(lines('pnpm.log')).toEqual([])
    expect(calls()).toEqual([])
  })

  it.each([['--check-login'], ['--execute']])('%s without pnpm: exit 2, before any API call', (mode) => {
    const {status, stderr} = run([mode], {PATH: pathWithout('pnpm')}, [BASH])
    expect(status).toBe(2)
    expect(stderr).toContain('reading the wrangler login runs pnpm exec, and pnpm is not on PATH.')
    expect(calls()).toEqual([])
  })
})

// Constructs that bash 3.2 (macOS /bin/bash, where `#!/usr/bin/env bash` may land on an operator's Mac)
// lacks. CI runs bash 5, so this list is what holds the floor there. Each rule names snippets it must
// flag; BASH32_IDIOMS is valid bash 3.2 that no rule may flag. The last rule is a policy rather than a
// syntax limit: an empty "${list[@]}" fails under set -u before bash 4.4, so the script uses no array.
const BASH4_ONLY: {name: string; pattern: RegExp; flags: string[]}[] = [
  {name: 'mapfile or readarray', pattern: /\b(mapfile|readarray)\b/, flags: ['mapfile -t lines <file', 'readarray -t lines <file']},
  {
    name: 'a declare attribute from bash 4 (A, n, g, l, u)',
    pattern: /\b(declare|local|typeset)\s+-[a-zA-Z]*[Anglu][a-zA-Z]*\b/,
    flags: ['declare -A seen=()', 'local -n ref=x', 'local -nr ref=x', 'declare -g x=1', 'declare -l lower', 'local -u upper', 'declare -Ar map']
  },
  {
    name: 'case modification',
    pattern: /\$\{!?\w+(\[[^\]]*\])?(\^\^|,,|\^|,)[^}]*\}/,
    flags: ['${x^^}', '${x,,}', '${x^}', '${x,}', '${x^^[a-z]}', '${list[0]^^}']
  },
  {name: 'parameter transformation', pattern: /\$\{\w+(\[[^\]]*\])?@[A-Za-z]\}/, flags: ['${x@Q}', '${x@U}', '${list[0]@Q}']},
  {name: 'local - (saved shell options)', pattern: /\blocal\s+-(\s|;|$)/, flags: ['local -', 'f() { local -; set -e; }']},
  {name: 'a |& pipe', pattern: /\|&/, flags: ['cmd |& tee log']},
  {name: 'an &>> redirection', pattern: /&>>/, flags: ['cmd &>>log']},
  {name: 'coproc', pattern: /\bcoproc\b/, flags: ['coproc cat']},
  {name: 'wait -n', pattern: /\bwait\s+-n\b/, flags: ['wait -n']},
  {name: 'a -v test', pattern: /(\[\[|\[|\btest)\s+-v\s/, flags: ['[[ -v X ]]', '[ -v X ]', 'test -v X']},
  {
    name: 'a variable from bash 4 or 5',
    pattern: /\b(BASHPID|BASH_ARGV0|EPOCHSECONDS|EPOCHREALTIME|SRANDOM)\b/,
    flags: ['echo $BASHPID', 'echo $EPOCHSECONDS', 'echo $SRANDOM']
  },
  {name: 'a printf %(...)T time format', pattern: /%\([^)]*\)T/, flags: ["printf '%(%F)T' -1"]},
  {name: 'a negative substring length', pattern: /\$\{\w+:[^}:]*:\s*-\s*\d+\}/, flags: ['${x:0:-1}', '${x:1: -2}']},
  {name: 'a ;& or ;;& case fall-through', pattern: /;;?&(\s|$)/, flags: ['a) echo a ;&', 'a) echo a ;;&', 'a) echo a ;& b) echo b ;;']},
  {name: 'a named file descriptor', pattern: /(?<!\$)\{\w+\}\s*[<>]/, flags: ['exec {fd}>file', 'exec {fd}<file']},
  {name: 'read -i or -N', pattern: /\bread\b[^\n;|&]*\s-[a-zA-Z]*[iN]\b/, flags: ['read -e -i default reply', 'read -ri default reply', 'read -N 1 key']},
  {
    name: 'a shopt from bash 4',
    pattern: /\bshopt\s+-s\s+(globstar|lastpipe|inherit_errexit|direxpand|globasciiranges)\b/,
    flags: ['shopt -s globstar', 'shopt -s lastpipe']
  },
  {
    name: 'an array (policy)',
    pattern: /\b\w+=\(|\$\{(?!(PIPESTATUS|BASH_\w+|FUNCNAME|GROUPS|DIRSTACK)\[)\w+\[[@*]\]\}/,
    flags: ['list=(a b)', 'for x in "${list[@]}"; do :; done']
  }
]
const BASH32_IDIOMS = [
  '${ids%,}',
  '${x//,}',
  '${sep:-,}',
  '${p#^}',
  '${x: -1}',
  '${y:-1}',
  'echo "${#x}"',
  '"${PIPESTATUS[@]}"',
  '"${BASH_SOURCE[0]}"',
  'local -r name=x',
  'declare -a list',
  'declare -i n',
  '[ -n "$x" ]',
  'test -n "$x"',
  'printf \'%s\' "$x"',
  'case $x in a) echo a ;; esac',
  'exec 3>file',
  'cmd 2>&1',
  'cmd >&2',
  'while IFS="$TAB" read -r kind id _; do',
  'read -n 1 key',
  '${EMAIL:-me@x}',
  'cmd &>/dev/null',
  'true;&>/dev/null',
  'x=$(cmd)',
  'n=$((n + 1))'
]

/** Every bash on this machine, by its real path: the one on PATH, and /bin/bash (3.2 on macOS). */
function bashes(): string[] {
  const onPath = spawnSync('bash', ['-c', 'printf %s "$BASH"'], {encoding: 'utf8'}).stdout
  const found = new Map<string, string>()
  for (const candidate of [onPath, '/bin/bash']) {
    if (candidate && existsSync(candidate)) {
      found.set(realpathSync(candidate), candidate)
    }
  }
  return [...found.values()]
}

describe('rollback-route.sh runs on bash 3.2', () => {
  it('each rule flags its bash 4 constructs, and no rule flags a bash 3.2 idiom', () => {
    for (const rule of BASH4_ONLY) {
      for (const snippet of rule.flags) {
        expect(rule.pattern.test(snippet), `${rule.name} must flag ${snippet}`).toBe(true)
      }
      for (const snippet of BASH32_IDIOMS) {
        expect(rule.pattern.test(snippet), `${rule.name} must pass ${snippet}`).toBe(false)
      }
    }
  })

  it('uses no construct that bash 3.2 lacks', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    const start = source.indexOf("readonly JSON_HELPER='")
    const end = source.indexOf("\n'\n", start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    // The JavaScript helper is not bash, and a comment may name a construct; the scan leaves both out.
    const bash = (source.slice(0, start) + source.slice(end + 3)).split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
    expect(bash).toContain('write_self_test_stub')
    const found = BASH4_ONLY.filter((rule) => rule.pattern.test(bash)).map((rule) => rule.name)
    expect(found).toEqual([])
  })

  it.each(bashes())('--self-test passes every case under %s, with no network call', (bash) => {
    const result = spawnSync(bash, [SCRIPT, '--self-test'], {cwd: scratch, encoding: 'utf8'})
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('self-test: 9 passed, 0 failed')
    expect(result.stdout).not.toContain('FAIL')
  }, 30_000)

  it('--self-test passes with a CDPATH set, run by a relative path from the repository', () => {
    // A relative cd target is where CDPATH applies: cd prints the directory, which once corrupted the path the self-test captures.
    const result = spawnSync('bash', ['scripts/rollback-route.sh', '--self-test'], {
      cwd: path.resolve('.'),
      env: {...process.env, CDPATH: '.'},
      encoding: 'utf8'
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('self-test: 9 passed, 0 failed')
  }, 30_000)
})
