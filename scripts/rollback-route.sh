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
#   scripts/rollback-route.sh              dry run, GETs only: the route and what --execute does
#   scripts/rollback-route.sh --execute    send the one DELETE, read the routes back, check the apex
#   scripts/rollback-route.sh --self-test  prove the script against a curl stub, with no network call
#
# The dry run sends one API GET. When no route matches, it also GETs the public /version.json, with
# no token, to say what answers the apex.
#
# Environment:
#   CLOUDFLARE_API_TOKEN         required, except for --self-test. --execute needs Zone > Workers
#                                Routes > Edit on jonathanlloyd.me (the API reference names it
#                                Workers Routes Write); the dry run needs Workers Routes Read or
#                                Edit. The script never prints the token, and the token is in no
#                                argv: curl reads the Authorization header from stdin.
#   CLOUDFLARE_ZONE_ID           optional; defaults to the jonathanlloyd.me zone.
#   ROLLBACK_ROUTE_WAIT_SECONDS  optional; how long --execute waits for Pages to answer the apex,
#                                0 to 600 (default 30).
#
# The script finds the route by pattern AND script, never by a remembered id: a dashboard edit
# replaces the route object and its id (runbook, "Route ownership"). Anything but exactly one match
# refuses.
#
# Exit codes: 0 done; 1 a failure, with the route unchanged as far as the API shows; 2 a usage
# error; 3 refused, nothing changed; 4 a DELETE was sent but the read-back failed, so the route
# state is unknown; 5 the route is gone, but Pages did not answer the apex within the wait.
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
# example) would run in place of the binary and print the header, so the script drops both names.
unset -f curl node

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
readonly WRANGLER_ROLLBACK='env -u CLOUDFLARE_API_TOKEN pnpm exec wrangler rollback [version-id] --name human-datastream --message "<reason>"'
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
# The routes and deleted modes exit 1 on an answer that is not a successful JSON envelope.
# shellcheck disable=SC2016 # JavaScript source: bash must not expand its template literals.
readonly JSON_HELPER='
const fs = require("node:fs");
const [mode, file, a, b] = process.argv.slice(1);
const clean = (v) => (v === undefined || v === null ? "(none)" : String(v).replace(/[\t\r\n]/g, " ") || "(empty)");
const fail = (why) => {
  process.stderr.write(`rollback-route: ${why}\n`);
  process.exit(1);
};
let body;
try {
  body = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  body = undefined;
}
const isObject = body !== null && typeof body === "object" && !Array.isArray(body);
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
Usage: scripts/rollback-route.sh [--execute | --self-test | --help]

Deletes the Workers Route jonathanlloyd.me/* (script human-datastream), so the apex returns to the
Pages project. Without a flag it is a dry run, GETs only: it prints the route and what --execute
does.
  --execute    send the one DELETE, read the routes back, then check that Pages answers the apex
  --self-test  prove the script against a curl stub, with no network call
Environment: CLOUDFLARE_API_TOKEN (Zone > Workers Routes > Edit for --execute), CLOUDFLARE_ZONE_ID
(optional; defaults to the jonathanlloyd.me zone), ROLLBACK_ROUTE_WAIT_SECONDS (optional; 0 to 600,
default 30).
EOF
}

# An exported API_TOKEN keeps its export flag through an assignment and would hand the token to every
# child, so the name starts unset.
unset API_TOKEN
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
    400 | 401 | 403) printf ' A %s usually means that the token is malformed or lacks a permission: the dry run needs Workers Routes Read or Edit, and --execute needs Workers Routes Edit.' "$1" ;;
  esac
}

api_errors() { node -e "$JSON_HELPER" errors "$1"; }

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
with your wrangler login (env -u keeps wrangler off a routes-only CLOUDFLARE_API_TOKEN):
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
others="$(env | grep -v '^STUB_TOKEN=' || true)"
case "$others" in *"$STUB_TOKEN"*) echo inherited >>"$here/env.log" ;; esac
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
SELF_TEST_TOKEN=''

# self_test_case NAME STATUS CALLS FIXTURE [ARG]: runs this script from a scratch directory with
# the stub first on PATH and the default zone. Then it checks the exit status and the calls, and
# that every call put --disable first, that no call inherited the token, and that the token reached
# no argv and no output.
self_test_case() {
  local name="$1" want_status="$2" want_calls="$3" fixture="$4" dir="$CLEANUP_DIR" status=0 calls why=''
  shift 4
  : >"$dir/bin/argv.log"
  : >"$dir/bin/calls.log"
  : >"$dir/bin/env.log"
  : >"$dir/bin/first.log"
  rm -f "$dir/bin/deleted"
  cp "$dir/$fixture.json" "$dir/bin/routes.json"
  if [ -e "$dir/$fixture-after.json" ]; then
    cp "$dir/$fixture-after.json" "$dir/bin/routes-after.json"
  else
    cp "$dir/$fixture.json" "$dir/bin/routes-after.json"
  fi
  (
    unset CLOUDFLARE_ZONE_ID
    cd "$dir/cwd"
    PATH="$dir/bin:$PATH" CLOUDFLARE_API_TOKEN="$SELF_TEST_TOKEN" STUB_TOKEN="$SELF_TEST_TOKEN" \
      STUB_ZONE="$DEFAULT_ZONE_ID" ROLLBACK_ROUTE_WAIT_SECONDS=0 \
      "$BASH" "$SELF_TEST_SCRIPT" "$@" </dev/null >"$dir/out" 2>&1
  ) || status=$?
  calls="$(self_test_calls "$dir/bin/calls.log")"
  if [ "$status" != "$want_status" ]; then
    why="exit $status, want $want_status"
  elif [ "$calls" != "$want_calls" ]; then
    why="calls [$calls], want [$want_calls]"
  elif grep -q -v -x -e '--disable' "$dir/bin/first.log"; then
    why='a curl call did not put --disable first'
  elif grep -q inherited "$dir/bin/env.log"; then
    why='curl inherited the token in its environment'
  elif grep -q -F -e "$SELF_TEST_TOKEN" "$dir/bin/argv.log" "$dir/out"; then
    why='the token reached an argv or the output'
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

# --self-test: no case can change the zone. curl is a stub first on PATH, and the token is fake, so
# even a stub that failed to load would meet a refusal (HTTP 400 or 403) at the first GET, before any
# DELETE.
self_test() {
  command -v node >/dev/null 2>&1 || die 1 'node is not on PATH (the script reads the API answers with it).'
  SELF_TEST_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
  SELF_TEST_TOKEN="self-test-token-$$"
  CLEANUP_DIR="$(mktemp -d "$TMP_ROOT/rollback-route-self-test.XXXXXX")"
  mkdir "$CLEANUP_DIR/bin" "$CLEANUP_DIR/cwd"
  write_self_test_stub "$CLEANUP_DIR/bin/curl"
  write_self_test_fixtures "$CLEANUP_DIR"
  say "rollback-route self-test with $BASH ($BASH_VERSION). No network call: curl is a stub, the token is fake."
  self_test_case 'no matching route: the dry run refuses (exit 3) and sends no DELETE' 3 \
    'GET:ok APEX:none' none
  self_test_case 'no matching route: --execute refuses (exit 3) and sends no DELETE' 3 \
    'GET:ok APEX:none' none --execute
  self_test_case 'two matching routes: the dry run refuses (exit 3) and sends no DELETE' 3 'GET:ok' two
  self_test_case 'two matching routes: --execute refuses (exit 3) and sends no DELETE' 3 'GET:ok' two --execute
  self_test_case 'one matching route: the dry run sends one GET and no DELETE' 0 'GET:ok' one
  self_test_case 'one matching route: --execute sends one DELETE for its id, reads back, checks the apex' 0 \
    "GET:ok DELETE:$SELF_TEST_ID:ok GET:ok APEX:none" one --execute
  say "self-test: $SELF_TEST_PASSED passed, $SELF_TEST_FAILED failed"
  if [ "$SELF_TEST_FAILED" -ne 0 ]; then
    exit 1
  fi
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
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    die 2 'CLOUDFLARE_API_TOKEN is not set. --execute needs Zone > Workers Routes > Edit on jonathanlloyd.me.'
  fi
  case "$CLOUDFLARE_API_TOKEN" in
    *[[:space:]]* | *[[:cntrl:]]*) die 2 'CLOUDFLARE_API_TOKEN holds whitespace or a control character.' ;;
  esac
  # Keep the token in this shell only: curl, node and the other children do not inherit it.
  API_TOKEN="$CLOUDFLARE_API_TOKEN"
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
  CLEANUP_DIR="$(mktemp -d "$TMP_ROOT/rollback-route.XXXXXX")"

  if [ "$mode" = execute ]; then
    say "rollback-route --execute: zone $ZONE_ID ($ZONE_SOURCE), pattern $ROUTE_PATTERN, script $ROUTE_SCRIPT."
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
