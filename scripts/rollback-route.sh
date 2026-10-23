#!/usr/bin/env bash
# rollback-route.sh -- the production rollback: delete the Workers Route jonathanlloyd.me/*
# (atlas decision 0160 PR A; decision 0162 item 14).
#
# The apex jonathanlloyd.me is a proxied CNAME to human-datastream.pages.dev. The route
# jonathanlloyd.me/* puts the human-datastream Worker in front of it. Deleting the route returns the
# apex to the Pages project in about 2 s (rehearsal Rollback 2a, 0 errors), and Pages serves its
# frozen build c9fc69f5. CI deploys do not re-create the route.
#
# This script replaces /tmp/pr-a-rollback.sh. macOS deleted that file (/usr/libexec/tmp_cleaner
# removes /tmp files idle for 3 days), and its last copy changed into a deleted worktree under
# `set -u` with no `set -e` (decision 0162 X2).
#
# Usage, from any directory:
#   scripts/rollback-route.sh                dry run, GETs only: the route and what --execute does
#   scripts/rollback-route.sh --execute      send the one DELETE, read the routes back, check the apex
#   scripts/rollback-route.sh --check-login  check the wrangler login token, with no API call
#   scripts/rollback-route.sh --self-test    prove the script against curl and pnpm stubs, with no network call
#
# The dry run sends one API GET. When no route matches, it also GETs the public /version.json, with
# no token, to say what answers the apex.
#
# Credentials (owner decision, 2026-10-20). The dry run reads the routes with CLOUDFLARE_API_TOKEN,
# the read-only token: CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ACCOUNT_READALL" scripts/rollback-route.sh.
# --execute ignores that variable. It takes the access token of the wrangler login from the
# repository's pinned wrangler: pnpm --dir <repository> exec wrangler auth token --json. In wrangler
# 4.149.0 (node_modules/wrangler/wrangler-dist/cli.js) that command answers {"type": "oauth",
# "token": ...} (:357187, :357190); it refreshes an expired login on its own (:131043-131062); and the
# default login scopes include workers_routes:write (:134469, :133400). When wrangler cannot give a
# token, --execute stops before its first API call: log in with `pnpm exec wrangler login` from the
# repository. --check-login reads the login the same way, prints OK or NOT OK, and makes no API
# call. `pnpm exec wrangler whoami` also checks the login, but it calls the API (:356870, :356886)
# and, in a terminal, can start a browser login (:130967-131007). Do not run `wrangler auth token`
# by hand: it prints the token, and wrangler writes it to its log file unless WRANGLER_WRITE_LOGS is
# false. The script never prints a token, and no token is in an argv: curl reads the Authorization
# header from stdin, and node reads the wrangler answer from stdin.
#
# Environment:
#   CLOUDFLARE_API_TOKEN         the dry run's token: Workers Routes Read or Edit on the zone.
#   CLOUDFLARE_ZONE_ID           optional; defaults to the jonathanlloyd.me zone.
#   ROLLBACK_ROUTE_WAIT_SECONDS  optional; how long --execute waits for Pages to answer the apex,
#                                0 to 600 (default 30).
#
# The script finds the route by pattern AND script, never by a remembered id: a dashboard edit
# replaces the route object and its id (runbook, "Route ownership"). Anything but exactly one match
# refuses.
#
# Exit codes: 0 done; 1 a failure, with the route unchanged as far as the API shows; 2 a usage
# error or a missing credential, with nothing sent; 3 refused, nothing changed; 4 a DELETE was sent
# but the read-back failed, so the route state is unknown; 5 the route is gone, but Pages did not
# answer the apex within the wait.
set -euo pipefail

# A trace (bash -x) would print the token, so the script turns tracing off.
case "$-" in
  *x*)
    set +x
    printf 'rollback-route: tracing is off in this script, because a trace would print the token.\n' >&2
    ;;
esac
# A CDPATH makes `cd` print the directory, which would corrupt a captured path.
unset CDPATH
# The environment can export shell functions. One named curl (a wrapper that adds --verbose, for
# example), printf or pnpm would run in place of the real command and could print a token, so the
# script drops every function it inherited before it defines its own.
while read -r _ _ inherited; do
  unset -f -- "$inherited"
done <<EOF
$(declare -F)
EOF
# The repository that holds this script. --execute and --check-login run its pinned wrangler.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly REPO_ROOT

readonly ROUTE_PATTERN='jonathanlloyd.me/*'
readonly ROUTE_SCRIPT='human-datastream'
# GET /zones?name=jonathanlloyd.me on 2026-10-17 (atlas decision 0162, item 3 evidence, row L2).
readonly DEFAULT_ZONE_ID='4d14ef06a76b6f09918d27d3cca0a9c3'
readonly API='https://api.cloudflare.com/client/v4'
# The public apex. Pages serves the frozen build c9fc69f5, whose version.json has no "runtime" key;
# the Worker answers "runtime": "workers". This URL never gets the token.
readonly APEX_VERSION_URL='https://jonathanlloyd.me/version.json'
readonly RUNBOOK='docs/decision-0160/cutover-rehearsal-runbook.md'
# The D7 runbook lives in the atlas repository; atlas PR #457 adds it.
readonly D7_RUNBOOK='atlas decisions/evidence/0162-open-items/item-03-d7-runbook.md (atlas PR #457)'
readonly WRANGLER_ROLLBACK='env -u CLOUDFLARE_API_TOKEN pnpm exec wrangler rollback [version-id] --name human-datastream --message "<reason>" --env-file /dev/null'
readonly HEX32='^[0-9a-f]{32}$'
readonly TAB=$'\t'
TMP_ROOT="${TMPDIR:-/tmp}"
readonly TMP_ROOT="${TMP_ROOT%/}"

# Reads one answer with node. Modes:
#   routes FILE PATTERN SCRIPT  one tab-separated line per route: match or other, id, pattern,
#                               script, request_limit_fail_open
#   deleted FILE ID             checks that a DELETE answer names ID
#   errors FILE                 prints the errors of an API answer (never fails)
#   apex FILE STATUS            classifies a /version.json answer: pages, worker or error
#   oauth-token                 reads a `wrangler auth token --json` answer on stdin and prints its
#                               token only when the type is "oauth". A failure names no value and
#                               exits 3 (an environment credential), 4 (not an oauth JSON answer)
#                               or 5 (no usable token)
# The routes and deleted modes exit 1 on an answer that is not a successful JSON envelope.
# shellcheck disable=SC2016 # JavaScript source: bash must not expand its template literals.
readonly JSON_HELPER='
const fs = require("node:fs");
const [mode, file, a, b] = process.argv.slice(1);
const clean = (v) => (v === undefined || v === null ? "(none)" : String(v).replace(/[\t\r\n]/g, " ") || "(empty)");
const fail = (why, code = 1) => {
  process.stderr.write(`rollback-route: ${why}\n`);
  process.exit(code);
};
let body;
try {
  body = JSON.parse(fs.readFileSync(mode === "oauth-token" ? 0 : file, "utf8"));
} catch {
  body = undefined;
}
const isObject = body !== null && typeof body === "object" && !Array.isArray(body);
if (mode === "oauth-token") {
  const kind = isObject && ["oauth", "api_token", "api_key"].includes(body.type) ? body.type : "unknown";
  if (kind === "api_token" || kind === "api_key") fail(`wrangler auth token answered type ${kind}, not oauth`, 3);
  if (kind !== "oauth") fail(`wrangler auth token answered type ${kind}, not oauth`, 4);
  if (typeof body.token !== "string" || !/^[\x21-\x7e]+$/.test(body.token)) fail("wrangler auth token answered no usable token", 5);
  process.stdout.write(body.token);
  process.exit(0);
}
if (mode === "apex") {
  if (a !== "200") process.stdout.write(`error HTTP ${clean(a)}\n`);
  else if (!isObject) process.stdout.write("error a 200 answer that is not a JSON object\n");
  else if (!("runtime" in body)) process.stdout.write(`pages build ${clean(body.build)}\n`);
  else process.stdout.write(`worker build ${clean(body.build)}, runtime ${clean(body.runtime)}\n`);
  process.exit(0);
}
const errors =
  isObject && Array.isArray(body.errors) && body.errors.length > 0
    ? body.errors.map((e) => `${clean(e && e.code)}: ${clean(e && e.message)}`).join("; ")
    : "none listed";
if (mode === "errors") {
  process.stdout.write(`${errors}\n`);
  process.exit(0);
}
if (!isObject) fail("the API answer is not a JSON object");
if (body.success !== true) fail(`the API answer has success ${clean(body.success)} (errors: ${errors})`);
if (mode === "routes") {
  if (!Array.isArray(body.result)) fail("the API answer has no result array");
  for (const r of body.result) {
    const kind = r && r.pattern === a && r.script === b ? "match" : "other";
    const fields = [kind, r && r.id, r && r.pattern, r && r.script, r && r.request_limit_fail_open];
    process.stdout.write(fields.map(clean).join("\t") + "\n");
  }
} else if (mode === "deleted") {
  if (!body.result || body.result.id !== a) fail(`the DELETE answer names id ${clean(body.result && body.result.id)}, not ${a}`);
} else {
  fail(`unknown helper mode ${clean(mode)}`);
}
'

CLEANUP_DIR=''
cleanup() {
  if [ -n "$CLEANUP_DIR" ]; then
    rm -rf "$CLEANUP_DIR"
  fi
}
trap cleanup EXIT

say() { printf '%s\n' "$*"; }
warn() { printf 'rollback-route: %s\n' "$*" >&2; }
note() { printf '%s\n' "$*" >&2; }

die() { # die CODE MESSAGE
  local code="$1"
  shift
  warn "$*"
  exit "$code"
}

usage() {
  cat <<'EOF'
Usage: scripts/rollback-route.sh [--execute | --check-login | --self-test | --help]

Deletes the Workers Route jonathanlloyd.me/* (script human-datastream), so the apex returns to the
Pages project. Without a flag it is a dry run, GETs only, with the read-only token: it prints the
route and what --execute does.
  --execute    take the token of the wrangler login (pnpm exec wrangler auth token --json, with
               the repository's wrangler), send the one DELETE, read the routes back, then check
               that Pages answers the apex. CLOUDFLARE_API_TOKEN plays no part.
  --check-login
               read the token of the wrangler login exactly as --execute does, then print OK or
               NOT OK, with the cause. OK means that wrangler holds an oauth token; it does not
               prove the token's scopes, or that the API accepts it. It makes no Cloudflare API
               call and never prints the token. It can refresh an expired login: a POST to
               Cloudflare's OAuth endpoint and a write to wrangler's own credential store. Without
               node, pnpm or the repository's wrangler, it stops first, with its own message.
  --self-test  prove the script against curl and pnpm stubs, with no network call
Environment: CLOUDFLARE_API_TOKEN, the dry run's read-only token
(CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ACCOUNT_READALL"); CLOUDFLARE_ZONE_ID (optional; defaults to the
jonathanlloyd.me zone); ROLLBACK_ROUTE_WAIT_SECONDS (optional; 0 to 600, default 30).
A missing or expired wrangler login stops --execute before any API call. Check the login with
--check-login, or with pnpm exec wrangler whoami, which calls the API and can start a browser login.
Log in again with pnpm exec wrangler login, from the repository. Do not run wrangler auth token by
hand: it prints the token, and wrangler writes it to its log file.
--self-test needs the repository's node_modules (pnpm install).
EOF
}

# An exported API_TOKEN keeps its export flag through an assignment and would hand the token to every
# child, so the name starts unset. So does answer: when the caller exported answer, bash exports a
# function's `local answer` too, and login_token keeps wrangler's raw answer, token included, in it.
unset API_TOKEN answer
API_TOKEN=''
HTTP_STATUS=''

# request METHOD PATH OUT: one API request. The body goes to OUT and the status to HTTP_STATUS. The
# token reaches curl on stdin, never in argv. --disable must come first: it stops curl from reading
# a config file (~/.curlrc), where --verbose or --trace would print the Authorization header.
# Returns non-zero on a transport error.
request() {
  HTTP_STATUS="$(printf 'Authorization: Bearer %s\n' "$API_TOKEN" |
    curl --disable --silent --show-error --connect-timeout 10 --max-time 30 --request "$1" \
      --header @- --output "$3" --write-out '%{http_code}' "$API$2")"
}

permission_hint() { # permission_hint STATUS
  case "$1" in
    400 | 401 | 403) printf ' A %s usually means that the token is malformed or lacks a permission: the dry run needs Workers Routes Read or Edit, and --execute needs a wrangler login with the workers_routes:write scope.' "$1" ;;
  esac
}

api_errors() { node -e "$JSON_HELPER" errors "$1"; }

LOGIN_CONTEXT='execute'
login_failed() { # login_failed REASON
  local fix="Check the wrangler login with pnpm exec wrangler whoami, and log in again with pnpm exec wrangler login; run both from $REPO_ROOT."
  if [ "$LOGIN_CONTEXT" = check-login ]; then
    note "wrangler login: NOT OK: $1."
    note "$fix"
    exit 2
  fi
  die 2 "$1, so --execute has no credential and sent nothing. $fix"
}

# login_token: puts the access token of the wrangler login in API_TOKEN (owner decision, 2026-10-20),
# from the repository's pinned wrangler (4.149.0, node_modules/wrangler/wrangler-dist/cli.js):
#   - wrangler answers an environment credential before the login (:357167-357178, through
#     :139750-139752 and :129541-129555; the names at :132034-132045), so the six credential names are
#     cleared, and the answer must say "oauth";
#   - --env-file /dev/null, because at startup wrangler loads .env and .env.local from the repository
#     into process.env, which would put a cleared name back (:366300-366304, :191028-191035,
#     :190959-190969); the flag replaces that file list (:366250-366254);
#   - WRANGLER_WRITE_LOGS=false, because wrangler otherwise appends every message it logs, this token
#     included, to its log file on disk (:69710-69716, :69632-69666);
#   - WRANGLER_SEND_METRICS=false, because the telemetry path can print a notice to stdout and write
#     its config (:162147-162173);
#   - WRANGLER_LOG=log, the default level, so that an inherited debug level puts nothing else on
#     stdout (:69695-69708; info and debug lines go to stdout, :69850-69857).
# The token goes from wrangler's stdout into a shell variable, then to node on stdin. It is never
# printed, written to a file, or put in an argv, and wrangler's stderr is dropped. wrangler refreshes
# an expired login itself (:131043-131062), which writes wrangler's own credential store. The login
# profile follows the directory, so `pnpm exec wrangler login` from the repository reaches this login.
login_token() {
  local answer status=0
  if [ ! -f "$REPO_ROOT/wrangler.jsonc" ] || [ ! -x "$REPO_ROOT/node_modules/.bin/wrangler" ]; then
    die 2 "reading the wrangler login needs the repository's pinned wrangler, but $REPO_ROOT has no wrangler.jsonc and node_modules/.bin/wrangler. Run the script from the repository, after pnpm install."
  fi
  command -v pnpm >/dev/null 2>&1 || die 2 'reading the wrangler login runs pnpm exec, and pnpm is not on PATH.'
  warn 'reading the token of the wrangler login (wrangler refreshes an expired login, which can take a few seconds)'
  answer="$(
    unset CLOUDFLARE_API_TOKEN CF_API_TOKEN CLOUDFLARE_API_KEY CF_API_KEY CLOUDFLARE_EMAIL CF_EMAIL
    WRANGLER_WRITE_LOGS=false WRANGLER_SEND_METRICS=false WRANGLER_LOG=log \
      pnpm --dir "$REPO_ROOT" exec wrangler auth token --json --env-file /dev/null </dev/null 2>/dev/null
  )" || status=$?
  if [ "$status" -ne 0 ]; then
    answer=''
    login_failed "wrangler auth token exited $status: the login is missing or expired, or wrangler failed"
  fi
  status=0
  API_TOKEN="$(printf '%s' "$answer" | node -e "$JSON_HELPER" oauth-token)" || status=$?
  answer=''
  case "$status" in
    0) ;;
    3) login_failed 'wrangler answered a credential from the environment, not the wrangler login' ;;
    4) login_failed 'wrangler printed something other than its JSON answer' ;;
    5) login_failed 'the wrangler answer held no usable token' ;;
    *) login_failed "the token helper failed with status $status" ;;
  esac
}

ROUTES=''
MATCH_COUNT=0
MATCH_ID=''

# fetch_routes OUT: lists the routes of the zone into ROUTES and counts the matching ones. Prints the
# reason and returns 1 on a transport error, a status other than 200, or an unsuccessful answer.
fetch_routes() {
  local out="$1" path="/zones/$ZONE_ID/workers/routes" kind id
  rm -f "$out"
  if ! request GET "$path" "$out"; then
    warn "GET $path: curl failed (see above)."
    return 1
  fi
  if [ "$HTTP_STATUS" != 200 ]; then
    warn "GET $path: HTTP $HTTP_STATUS (errors: $(api_errors "$out")).$(permission_hint "$HTTP_STATUS")"
    return 1
  fi
  ROUTES="$(node -e "$JSON_HELPER" routes "$out" "$ROUTE_PATTERN" "$ROUTE_SCRIPT")" || return 1
  MATCH_COUNT=0
  MATCH_ID=''
  while IFS="$TAB" read -r kind id _; do
    if [ "$kind" = match ]; then
      MATCH_COUNT=$((MATCH_COUNT + 1))
      MATCH_ID="$id"
    fi
  done <<EOF
$ROUTES
EOF
}

print_routes() {
  local kind id pattern script fail_open
  if [ -z "$ROUTES" ]; then
    say '  (no routes)'
    return 0
  fi
  while IFS="$TAB" read -r kind id pattern script fail_open; do
    printf '  %-5s %s  %s -> %s  request_limit_fail_open=%s\n' "$kind" "$id" "$pattern" "$script" "$fail_open"
  done <<EOF
$ROUTES
EOF
}

DELETE_PROBLEM=''

# delete_route ID: sends the one DELETE. Sets DELETE_PROBLEM to '' when the API confirmed it, or to
# what went wrong. It never stops the script: the caller reads the routes back whatever happened.
delete_route() {
  local out="$CLEANUP_DIR/delete.json" check
  DELETE_PROBLEM=''
  rm -f "$out"
  if ! request DELETE "/zones/$ZONE_ID/workers/routes/$1" "$out"; then
    DELETE_PROBLEM='curl failed (see above)'
  elif [ "$HTTP_STATUS" != 200 ]; then
    DELETE_PROBLEM="HTTP $HTTP_STATUS (errors: $(api_errors "$out")).$(permission_hint "$HTTP_STATUS")"
  elif ! check="$(node -e "$JSON_HELPER" deleted "$out" "$1" 2>&1)"; then
    DELETE_PROBLEM="${check#rollback-route: }"
  fi
}

APEX_STATE=''

# probe_apex [MAX_TIME]: one GET of the public /version.json, with no token, in at most MAX_TIME
# seconds (default 10). Sets APEX_STATE to "pages ...", "worker ..." or "error ...". The query string
# keeps a cache from answering.
probe_apex() {
  local out="$CLEANUP_DIR/version.json" max_time="${1:-10}" status
  rm -f "$out"
  if status="$(curl --disable --silent --show-error --connect-timeout "$max_time" --max-time "$max_time" \
    --output "$out" --write-out '%{http_code}' "$APEX_VERSION_URL?rollback-check=$(date +%s)")"; then
    APEX_STATE="$(node -e "$JSON_HELPER" apex "$out" "$status")"
  else
    APEX_STATE='error curl failed (see above)'
  fi
}

# wait_for_pages: probes the apex every 2 s until Pages answers or the deadline, WAIT_SECONDS from
# now, passes. Each probe gets the time left (1 s at least, 10 s at most), so a slow apex cannot
# stretch the wait.
wait_for_pages() {
  local deadline=$((SECONDS + WAIT_SECONDS)) left
  while :; do
    left=$((deadline - SECONDS))
    if [ "$left" -gt 10 ]; then
      left=10
    elif [ "$left" -lt 1 ]; then
      left=1
    fi
    probe_apex "$left"
    case "$APEX_STATE" in pages*) return 0 ;; esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      return 1
    fi
    sleep 2
  done
}

explain() {
  cat <<EOF

What --execute does:
  - It deletes the route above, so the human-datastream Worker stops answering jonathanlloyd.me.
  - The apex is a proxied CNAME to human-datastream.pages.dev, so it returns to the Pages project
    human-datastream in about 2 s (rehearsal Rollback 2a: 0 errors). The script then checks that
    Pages answers $APEX_VERSION_URL.
  - Pages serves its frozen build c9fc69f5 of 2026-10-13: the data-free dashboard, and /privacy
    with the contact address in clear in the build. On the apex, only the zone's Email Address
    Obfuscation rewrites that address, while that zone setting is on.
  - The rollback lasts until someone re-creates the route; CI deploys do not. The way back is the
    "Re-creation (production)" section of $RUNBOOK.
  - It ends at D7. Decision 0162 item 3 replaces the apex CNAME with a Workers Custom Domain, then
    deletes this route. From the attach on, the Worker answers the apex without the route, so this
    script rolls nothing back. Undo the attach first, with Step 2 (d) of the D7 runbook:
    $D7_RUNBOOK.
For a fault in the composed page, a Worker version rollback is the safer path. It keeps the route,
so the apex stays on a recent Worker build, not the frozen Pages build. Run it from the repository
with your wrangler login (env -u and --env-file /dev/null keep wrangler off any other token):
  $WRANGLER_ROLLBACK
EOF
}

refuse_no_match() {
  warn "refusing: no route has pattern $ROUTE_PATTERN and script $ROUTE_SCRIPT, so there is nothing to delete."
  probe_apex
  note "The apex answers now: $APEX_STATE."
  note 'Three causes fit:'
  note '  - This rollback already ran. Then Pages answers the apex ("pages" above).'
  note "  - CLOUDFLARE_ZONE_ID names another zone. This run read zone $ZONE_ID ($ZONE_SOURCE)."
  note '  - D7 has run (decision 0162 item 3), so the route is gone and this rollback no longer applies.'
  note '    Roll back the Worker version instead, from the repository:'
  note "    $WRANGLER_ROLLBACK"
  exit 3
}

# --self-test fixtures: a matching route, a second matching route, and two near misses (the right
# pattern for another script, the right script on another pattern).
readonly SELF_TEST_ID='0123456789abcdef0123456789abcdef'
write_self_test_fixtures() { # write_self_test_fixtures DIR
  local head='{"success":true,"errors":[],"messages":[],"result":['
  local match="{\"id\":\"$SELF_TEST_ID\",\"pattern\":\"$ROUTE_PATTERN\",\"script\":\"$ROUTE_SCRIPT\",\"request_limit_fail_open\":true}"
  local twin="{\"id\":\"00112233445566778899aabbccddeeff\",\"pattern\":\"$ROUTE_PATTERN\",\"script\":\"$ROUTE_SCRIPT\",\"request_limit_fail_open\":false}"
  local near="{\"id\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"pattern\":\"$ROUTE_PATTERN\",\"script\":\"pr-a-rehearsal\"},{\"id\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"pattern\":\"pr-a-rehearsal.$ROUTE_PATTERN\",\"script\":\"$ROUTE_SCRIPT\"}"
  printf '%s%s]}' "$head" "$near" >"$1/none.json"
  printf '%s%s,%s]}' "$head" "$match" "$near" >"$1/one.json"
  printf '%s%s]}' "$head" "$near" >"$1/one-after.json"
  printf '%s%s,%s]}' "$head" "$match" "$twin" >"$1/two.json"
}

# The curl stand-in for --self-test. It logs each call, its first argument, and whether its
# environment holds the token under any name; it checks the Authorization header that the script
# sends on stdin; and it answers from the fixtures. A DELETE marks the route gone, so the read-back
# serves routes-after.json and the apex answers from Pages.
write_self_test_stub() { # write_self_test_stub FILE
  cat >"$1" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
here="$(dirname "$0")"
printf '%s\n' "$1" >>"$here/first.log"
printf '%s\n' "$*" >>"$here/argv.log"
others="$(env | grep -v '^STUB_' || true)"
for secret in $STUB_SECRETS; do
  case "$others" in *"$secret"*) echo inherited >>"$here/env.log" ;; esac
done
method=GET out='' url='' auth=none
while [ "$#" -gt 0 ]; do
  case "$1" in
    --request) method="$2"; shift 2 ;;
    --output) out="$2"; shift 2 ;;
    --header)
      if [ "$2" = @- ] && [ "$(cat)" = "Authorization: Bearer $STUB_TOKEN" ]; then auth=ok; else auth=bad; fi
      shift 2 ;;
    --connect-timeout | --max-time | --write-out) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s %s %s\n' "$auth" "$method" "$url" >>"$here/calls.log"
routes="https://api.cloudflare.com/client/v4/zones/$STUB_ZONE/workers/routes"
case "$url" in
  https://jonathanlloyd.me/version.json\?*)
    if [ -e "$here/deleted" ]; then
      printf '{"build":"c9fc69f551bfd85eb64ccc39d3c5d4dc1e259e11","builtAt":"2026-10-13T18:25:43.140Z"}' >"$out"
    else
      printf '{"build":"0000000000000000000000000000000000000000","runtime":"workers"}' >"$out"
    fi
    printf 200
    exit 0
    ;;
esac
if [ "$method" = GET ] && [ "$url" = "$routes" ]; then
  if [ -e "$here/deleted" ]; then cp "$here/routes-after.json" "$out"; else cp "$here/routes.json" "$out"; fi
  printf 200
elif [ "$method" = DELETE ] && [ "${url%/*}" = "$routes" ]; then
  : >"$here/deleted"
  printf '{"success":true,"errors":[],"messages":[],"result":{"id":"%s"}}' "${url##*/}" >"$out"
  printf 200
else
  printf '{"success":false,"errors":[{"code":7003,"message":"no stubbed answer"}]}' >"$out"
  printf 404
fi
STUB
  chmod 700 "$1"
}

# The pnpm stand-in for --self-test. It logs its arguments and every credential variable it
# received, and it answers `--dir <repository> exec wrangler auth token --json` with a fake oauth
# token, or, when the login-missing marker exists, fails as wrangler does with no login.
write_self_test_pnpm() { # write_self_test_pnpm FILE
  cat >"$1" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
here="$(dirname "$0")"
printf '%s\n' "$*" >>"$here/pnpm.log"
for name in CLOUDFLARE_API_TOKEN CF_API_TOKEN CLOUDFLARE_API_KEY CF_API_KEY CLOUDFLARE_EMAIL CF_EMAIL; do
  if [ -n "${!name:-}" ]; then echo "$name" >>"$here/pnpm-env.log"; fi
done
others="$(env | grep -v '^STUB_' || true)"
for secret in $STUB_SECRETS; do
  case "$others" in *"$secret"*) echo "a token in its environment" >>"$here/pnpm-env.log" ;; esac
done
if [ "${WRANGLER_WRITE_LOGS:-}" != false ]; then echo WRANGLER_WRITE_LOGS >>"$here/pnpm-env.log"; fi
if [ "$#" -ne 9 ] || [ "$1" != --dir ] || [ "$3 $4 $5 $6 $7 $8 $9" != 'exec wrangler auth token --json --env-file /dev/null' ]; then
  echo 'pnpm stand-in: unexpected arguments' >&2
  exit 64
fi
if [ -e "$here/login-missing" ]; then
  echo 'Not logged in. Please run wrangler login to authenticate.' >&2
  exit 1
fi
printf '{\n  "type": "oauth",\n  "token": "%s"\n}\n' "$STUB_LOGIN_TOKEN"
STUB
  chmod 700 "$1"
}

# self_test_calls LOG: the calls the stub saw, as "GET:ok DELETE:<id>:ok GET:ok APEX:none". The
# suffix is how the call authenticated: ok (the header on stdin), bad, or none.
self_test_calls() {
  local auth method url seq=''
  while read -r auth method url; do
    case "$url" in
      https://jonathanlloyd.me/version.json*) seq="$seq APEX:$auth" ;;
      *)
        if [ "$method" = DELETE ]; then
          seq="$seq DELETE:${url##*/}:$auth"
        else
          seq="$seq $method:$auth"
        fi
        ;;
    esac
  done <"$1"
  printf '%s' "${seq# }"
}

SELF_TEST_PASSED=0
SELF_TEST_FAILED=0
SELF_TEST_SCRIPT=''
SELF_TEST_READONLY=''
SELF_TEST_OAUTH=''
# The self-test runs its cases against a zone that does not exist, so that no case could reach the
# real route, even if a stub failed to load.
readonly SELF_TEST_ZONE='00000000000000000000000000000000'

# self_test_case NAME STATUS CALLS FIXTURE LOGIN [ARG]: runs this script from a scratch directory,
# with the stubs first on PATH and CLOUDFLARE_API_TOKEN set to the fake read-only token. LOGIN is
# "login" (the pnpm stand-in gives a fake oauth token) or "no-login" (it fails as wrangler does).
# Then it checks the exit status and the calls, that the dry run used the read-only token and
# --execute the login token, that only --execute and --check-login asked wrangler (once, with the
# arguments the script must use and no credential variable), that every curl call put --disable
# first, that no child inherited a token, and that no token reached an argv or the output.
self_test_case() {
  local name="$1" want_status="$2" want_calls="$3" fixture="$4" login="$5" dir="$CLEANUP_DIR" status=0
  local calls why='' expected_token="$SELF_TEST_READONLY" want_pnpm=''
  shift 5
  if [ "${1:-}" = --execute ] || [ "${1:-}" = --check-login ]; then
    expected_token="$SELF_TEST_OAUTH"
    want_pnpm="--dir $REPO_ROOT exec wrangler auth token --json --env-file /dev/null"
  fi
  for log in argv calls env first pnpm pnpm-env; do
    : >"$dir/bin/$log.log"
  done
  rm -f "$dir/bin/deleted" "$dir/bin/login-missing"
  if [ "$login" = no-login ]; then
    : >"$dir/bin/login-missing"
  fi
  cp "$dir/$fixture.json" "$dir/bin/routes.json"
  if [ -e "$dir/$fixture-after.json" ]; then
    cp "$dir/$fixture-after.json" "$dir/bin/routes-after.json"
  else
    cp "$dir/$fixture.json" "$dir/bin/routes-after.json"
  fi
  (
    cd "$dir/cwd"
    PATH="$dir/bin:$PATH" CLOUDFLARE_API_TOKEN="$SELF_TEST_READONLY" CLOUDFLARE_ZONE_ID="$SELF_TEST_ZONE" \
      STUB_TOKEN="$expected_token" STUB_LOGIN_TOKEN="$SELF_TEST_OAUTH" STUB_ZONE="$SELF_TEST_ZONE" \
      STUB_SECRETS="$SELF_TEST_READONLY $SELF_TEST_OAUTH" \
      ROLLBACK_ROUTE_WAIT_SECONDS=0 "$BASH" "$SELF_TEST_SCRIPT" "$@" </dev/null >"$dir/out" 2>&1
  ) || status=$?
  calls="$(self_test_calls "$dir/bin/calls.log")"
  if [ "$status" != "$want_status" ]; then
    why="exit $status, want $want_status"
  elif [ "$calls" != "$want_calls" ]; then
    why="calls [$calls], want [$want_calls]"
  elif [ "$(cat "$dir/bin/pnpm.log")" != "$want_pnpm" ]; then
    why="pnpm calls [$(tr '\n' ';' <"$dir/bin/pnpm.log")], want [$want_pnpm]"
  elif [ -s "$dir/bin/pnpm-env.log" ]; then
    why="pnpm received $(tr '\n' ' ' <"$dir/bin/pnpm-env.log")"
  elif grep -q -v -x -e '--disable' "$dir/bin/first.log"; then
    why='a curl call did not put --disable first'
  elif grep -q inherited "$dir/bin/env.log"; then
    why='curl inherited a token in its environment'
  elif grep -q -F -e "$SELF_TEST_READONLY" -e "$SELF_TEST_OAUTH" "$dir/bin/argv.log" "$dir/bin/pnpm.log" "$dir/out"; then
    why='a token reached an argv or the output'
  fi
  if [ -z "$why" ]; then
    SELF_TEST_PASSED=$((SELF_TEST_PASSED + 1))
    say "PASS $name"
  else
    SELF_TEST_FAILED=$((SELF_TEST_FAILED + 1))
    say "FAIL $name: $why"
    sed 's/^/    | /' "$dir/out"
  fi
}

# --self-test: no case can change a real route. curl and pnpm are stubs first on PATH, and the
# self-test stops unless both resolve to its stubs; the tokens are fake; and every case runs against
# a zone that does not exist.
self_test() {
  local tool
  command -v node >/dev/null 2>&1 || die 1 'node is not on PATH (the script reads the API answers with it).'
  if [ ! -x "$REPO_ROOT/node_modules/.bin/wrangler" ]; then
    die 1 "self-test: the --execute and --check-login cases need the repository's node_modules: run pnpm install in $REPO_ROOT."
  fi
  SELF_TEST_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
  SELF_TEST_READONLY="self-test-readonly-$$"
  SELF_TEST_OAUTH="self-test-oauth-$$"
  CLEANUP_DIR="$(mktemp -d "$TMP_ROOT/rollback-route-self-test.XXXXXX")"
  mkdir "$CLEANUP_DIR/bin" "$CLEANUP_DIR/cwd"
  write_self_test_stub "$CLEANUP_DIR/bin/curl"
  write_self_test_pnpm "$CLEANUP_DIR/bin/pnpm"
  write_self_test_fixtures "$CLEANUP_DIR"
  for tool in curl pnpm; do
    if [ "$(PATH="$CLEANUP_DIR/bin:$PATH" command -v "$tool")" != "$CLEANUP_DIR/bin/$tool" ]; then
      die 1 "self-test: $tool does not resolve to the stub, so no case runs."
    fi
  done
  say "rollback-route self-test with $BASH ($BASH_VERSION). No network call: curl and pnpm are stubs, the tokens are fake."
  self_test_case 'no matching route: the dry run refuses (exit 3) and sends no DELETE' 3 \
    'GET:ok APEX:none' none login
  self_test_case 'no matching route: --execute refuses (exit 3) and sends no DELETE' 3 \
    'GET:ok APEX:none' none login --execute
  self_test_case 'two matching routes: the dry run refuses (exit 3) and sends no DELETE' 3 'GET:ok' two login
  self_test_case 'two matching routes: --execute refuses (exit 3) and sends no DELETE' 3 'GET:ok' two login --execute
  self_test_case 'one matching route: the dry run sends one GET and no DELETE' 0 'GET:ok' one login
  self_test_case 'one matching route: --execute sends one DELETE for its id, reads back, checks the apex' 0 \
    "GET:ok DELETE:$SELF_TEST_ID:ok GET:ok APEX:none" one login --execute
  self_test_case 'no wrangler login: --execute stops (exit 2) before any API call' 2 '' one no-login --execute
  self_test_case 'a wrangler login: --check-login exits 0 and makes no API call' 0 '' one login --check-login
  self_test_case 'no wrangler login: --check-login exits 2 and makes no API call' 2 '' one no-login --check-login
  say "self-test: $SELF_TEST_PASSED passed, $SELF_TEST_FAILED failed"
  if [ "$SELF_TEST_FAILED" -ne 0 ]; then
    exit 1
  fi
}

# --check-login (owner decision, 2026-10-21): reads the token of the wrangler login exactly as
# --execute does (login_token), checks that the answer is an oauth token, and prints OK or NOT OK.
# main exits after it, before any code that talks to the Cloudflare API. The token is never printed,
# and CLOUDFLARE_API_TOKEN is unset first, so the token helper does not inherit the read-only token.
# wrangler can refresh an expired login on the way: a POST to Cloudflare's OAuth endpoint and a
# write to wrangler's own credential store.
check_login() {
  command -v node >/dev/null 2>&1 || die 1 'node is not on PATH (the script reads the wrangler answer with it).'
  unset CLOUDFLARE_API_TOKEN
  LOGIN_CONTEXT='check-login'
  login_token
  API_TOKEN=''
  say 'wrangler login: OK (the answer is an oauth token; no Cloudflare API call was made)'
}

ZONE_ID=''
ZONE_SOURCE=''
WAIT_SECONDS=30

main() {
  local mode=dry-run
  if [ "$#" -gt 1 ]; then
    usage >&2
    exit 2
  fi
  case "${1:-}" in
    '') ;;
    --execute) mode=execute ;;
    --check-login)
      check_login
      exit 0
      ;;
    --self-test)
      self_test
      exit 0
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac

  command -v curl >/dev/null 2>&1 || die 1 'curl is not on PATH.'
  command -v node >/dev/null 2>&1 || die 1 'node is not on PATH (the script reads the API answers with it).'
  if [ "$mode" = execute ]; then
    # --execute uses the wrangler login only (owner decision, 2026-10-20).
    if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
      warn '--execute ignores CLOUDFLARE_API_TOKEN; it uses the wrangler login.'
    fi
  else
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
      die 2 "CLOUDFLARE_API_TOKEN is not set. The dry run reads the routes with the read-only token: CLOUDFLARE_API_TOKEN=\"\$CLOUDFLARE_ACCOUNT_READALL\" $0"
    fi
    case "$CLOUDFLARE_API_TOKEN" in
      *[[:space:]]* | *[[:cntrl:]]*) die 2 'CLOUDFLARE_API_TOKEN holds whitespace or a control character.' ;;
    esac
    # Keep the token in this shell only: curl, node and the other children do not inherit it.
    API_TOKEN="$CLOUDFLARE_API_TOKEN"
  fi
  unset CLOUDFLARE_API_TOKEN
  if [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
    ZONE_ID="$CLOUDFLARE_ZONE_ID"
    ZONE_SOURCE='from CLOUDFLARE_ZONE_ID'
  else
    ZONE_ID="$DEFAULT_ZONE_ID"
    ZONE_SOURCE='the default'
  fi
  [[ "$ZONE_ID" =~ $HEX32 ]] || die 2 'CLOUDFLARE_ZONE_ID is not a 32-character lowercase hex zone id.'
  WAIT_SECONDS="${ROLLBACK_ROUTE_WAIT_SECONDS:-30}"
  case "$WAIT_SECONDS" in
    '' | *[!0-9]*) die 2 'ROLLBACK_ROUTE_WAIT_SECONDS is not a whole number of seconds.' ;;
  esac
  # The length check keeps the number inside shell arithmetic; 10# reads 08 or 09 as decimal, not octal.
  if [ "${#WAIT_SECONDS}" -gt 3 ] || [ "$((10#$WAIT_SECONDS))" -gt 600 ]; then
    die 2 'ROLLBACK_ROUTE_WAIT_SECONDS must be 0 to 600.'
  fi
  WAIT_SECONDS=$((10#$WAIT_SECONDS))
  if [ "$mode" = execute ]; then
    login_token
  fi
  CLEANUP_DIR="$(mktemp -d "$TMP_ROOT/rollback-route.XXXXXX")"

  if [ "$mode" = execute ]; then
    say "rollback-route --execute, with the wrangler login: zone $ZONE_ID ($ZONE_SOURCE), pattern $ROUTE_PATTERN, script $ROUTE_SCRIPT."
  else
    say "rollback-route dry run (GET only): zone $ZONE_ID ($ZONE_SOURCE), pattern $ROUTE_PATTERN, script $ROUTE_SCRIPT."
  fi
  fetch_routes "$CLEANUP_DIR/routes.json" || exit 1
  say 'Routes on the zone:'
  print_routes
  if [ "$MATCH_COUNT" -eq 0 ]; then
    refuse_no_match
  fi
  if [ "$MATCH_COUNT" -gt 1 ]; then
    die 3 "refusing: $MATCH_COUNT routes have pattern $ROUTE_PATTERN and script $ROUTE_SCRIPT, and this script deletes exactly one. Resolve the duplicates in the dashboard."
  fi
  [[ "$MATCH_ID" =~ $HEX32 ]] || die 3 'refusing: the matching route id is not a 32-character lowercase hex id.'
  explain

  if [ "$mode" = dry-run ]; then
    say ''
    say "Dry run: nothing changed. To delete route $MATCH_ID, run: $0 --execute"
    exit 0
  fi

  say ''
  say "$(date -u +%Y-%m-%dT%H:%M:%SZ) sending DELETE /zones/$ZONE_ID/workers/routes/$MATCH_ID"
  delete_route "$MATCH_ID"
  if [ -z "$DELETE_PROBLEM" ]; then
    say "The API confirmed the DELETE of route $MATCH_ID."
  else
    warn "the DELETE is not confirmed: $DELETE_PROBLEM"
  fi
  say 'Reading the routes back:'
  if ! fetch_routes "$CLEANUP_DIR/after.json"; then
    if [ -z "$DELETE_PROBLEM" ]; then
      die 4 'the API confirmed the DELETE, but the read-back failed, so the route is very likely gone. Run the dry run to confirm.'
    fi
    die 4 'the DELETE is not confirmed and the read-back failed, so the route state is unknown. Run the dry run to read the routes.'
  fi
  print_routes
  if [ "$MATCH_COUNT" -ne 0 ]; then
    if [ -z "$DELETE_PROBLEM" ]; then
      die 1 "the API confirmed the DELETE, but the read-back still lists $MATCH_COUNT matching route(s). Check the route in the dashboard."
    fi
    die 1 'the route is still there, so nothing changed.'
  fi
  if [ -n "$DELETE_PROBLEM" ]; then
    warn 'the DELETE answer was unexpected, but the read-back lists no matching route, so the route is gone.'
  fi
  say "The route is gone. Waiting up to about $WAIT_SECONDS s for Pages to answer $APEX_VERSION_URL."
  if ! wait_for_pages; then
    case "$APEX_STATE" in
      worker*)
        warn "the route is gone, but the Worker still answers the apex ($APEX_STATE)."
        note 'A Workers Custom Domain on the apex (D7, decision 0162 item 3) answers without the route, so this'
        note 'rollback does not apply. Undo the attach first, with Step 2 (d) of the D7 runbook:'
        note "  $D7_RUNBOOK."
        note "If D7 has not run, wait and re-check: curl -s $APEX_VERSION_URL (Pages answers with no \"runtime\" key)."
        ;;
      *)
        warn "the route is gone, but the apex answers with an error ($APEX_STATE)."
        note 'Check that the apex is still a proxied CNAME to human-datastream.pages.dev and that the Pages'
        note "custom domain is active. To undo, re-create the route: the \"Re-creation (production)\" section of $RUNBOOK."
        ;;
    esac
    exit 5
  fi
  say "Done: Pages answers the apex ($APEX_STATE)."
  say "Way back: the \"Re-creation (production)\" section of $RUNBOOK."
}

main "$@"
