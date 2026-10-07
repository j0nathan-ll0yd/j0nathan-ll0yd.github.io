#!/bin/bash
# Agent Readiness Local Validator
# Tests all 12 checks from isitagentready.com against a target URL, plus the
# MCP and WebMCP checks of atlas decision 0158.
# Usage: ./scripts/agent-readiness-check.sh [URL] [BUILD_DIR]
#   URL       - Site to test (default: https://jonathanlloyd.me)
#   BUILD_DIR - Local build output to test (default: none, uses live URL)
#
# When BUILD_DIR is provided, tests are run against local files via
# a temporary HTTP server. This catches deployment issues before pushing.

set -euo pipefail

# --- Configuration ---
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TARGET_URL="${1:-https://jonathanlloyd.me}"
BUILD_DIR="${2:-}"
BASE_URL="$TARGET_URL"
EXPECTED_CONTENT_USAGE='train-ai=n, search=y'
PASS=0
FAIL=0
SKIP=0
TOTAL=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# --- Helpers ---
log_pass() { echo -e "  ${GREEN}PASS${NC}  $1"; PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); }
log_fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); }
log_skip() { echo -e "  ${YELLOW}SKIP${NC}  $1"; SKIP=$((SKIP + 1)); TOTAL=$((TOTAL + 1)); }
log_info() { echo -e "  ${CYAN}INFO${NC}  $1"; }
log_section() { echo -e "\n${BOLD}=== $1 ===${NC}"; }

# Fetch a URL, return HTTP status code
http_status() {
  local url="$1"
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo "000"
}

# Fetch headers for a URL
fetch_headers() {
  local url="$1"
  curl -sI --max-time 10 "$url" 2>/dev/null || echo ""
}

# Fetch body for a URL
fetch_body() {
  local url="$1"
  curl -s --max-time 10 "$url" 2>/dev/null || echo ""
}

# Fetch with custom Accept header
fetch_with_accept() {
  local url="$1"
  local accept="$2"
  curl -sI --max-time 10 -H "Accept: $accept" "$url" 2>/dev/null || echo ""
}

# Check if local file exists
local_file_exists() {
  local path="$1"
  [ -f "${BUILD_DIR}${path}" ]
}

# Read local file content
local_file_content() {
  local path="$1"
  cat "${BUILD_DIR}${path}" 2>/dev/null || echo ""
}

# --- Mode detection ---
if [ -n "$BUILD_DIR" ]; then
  echo -e "${BOLD}Testing local build: ${BUILD_DIR}${NC}"
  if [ ! -d "$BUILD_DIR" ]; then
    echo -e "${RED}Error: Build directory '${BUILD_DIR}' not found.${NC}"
    echo "Run 'pnpm build' first, then: $0 https://example.com ./dist"
    exit 1
  fi
  # Strip trailing slash
  BUILD_DIR="${BUILD_DIR%/}"
else
  echo -e "${BOLD}Testing live site: ${TARGET_URL}${NC}"
fi

# --- Check 1: robots.txt ---
log_section "Check 1: robots.txt"
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/robots.txt"; then
    log_pass "robots.txt exists in build output"
  else
    log_fail "robots.txt missing from build output"
  fi
else
  status=$(http_status "${BASE_URL}/robots.txt")
  if [ "$status" = "200" ]; then
    log_pass "robots.txt returns 200"
  else
    log_fail "robots.txt returns HTTP $status"
  fi
fi

# --- Check 2: Sitemap ---
log_section "Check 2: Sitemap"
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/sitemap-index.xml"; then
    log_pass "sitemap-index.xml exists in build output"
  else
    log_fail "sitemap-index.xml missing from build output"
  fi
else
  status=$(http_status "${BASE_URL}/sitemap-index.xml")
  if [ "$status" = "200" ]; then
    log_pass "sitemap-index.xml returns 200"
  else
    log_fail "sitemap-index.xml returns HTTP $status"
  fi
fi

# --- Check 3: Link Headers ---
log_section "Check 3: Link Headers (RFC 8288)"
if [ -n "$BUILD_DIR" ]; then
  log_info "Link headers require live server — skipping local check"
  log_info "Verify after deploy: curl -sI ${BASE_URL}/ | grep -i '^link:'"
  SKIP=$((SKIP + 1)); TOTAL=$((TOTAL + 1))
else
  headers=$(fetch_headers "${BASE_URL}/")
  link_header=$(echo "$headers" | grep -i '^link:' || true)
  if [ -n "$link_header" ]; then
    log_pass "Link header present: $(echo "$link_header" | tr -d '\r')"
    # Verify it contains llms.txt reference
    if echo "$link_header" | grep -qi 'llms.txt\|describedby'; then
      log_info "  Contains llms.txt describedby link"
    fi
    if echo "$link_header" | grep -qi 'api-catalog'; then
      log_info "  Contains api-catalog link"
    fi
    if echo "$link_header" | grep -qi 'sitemap'; then
      log_info "  Contains sitemap link"
    fi
    if echo "$link_header" | grep -q 'rel="ard"'; then
      log_pass "Link header advertises </.well-known/ard.json>; rel=\"ard\" (ARD v0.91)"
    else
      log_fail "Link header lacks rel=\"ard\""
    fi
  else
    log_fail "No Link header on GET /"
    log_info "  Fix: LINK_HEADER in functions/_middleware.ts"
  fi
fi

# --- Check 4: Markdown Negotiation ---
log_section "Check 4: Markdown Negotiation"
if [ -n "$BUILD_DIR" ]; then
  log_info "Markdown negotiation requires live server — skipping local check"
  log_info "Verify after deploy: curl -sI -H 'Accept: text/markdown' ${BASE_URL}/"
  SKIP=$((SKIP + 1)); TOTAL=$((TOTAL + 1))
else
  headers=$(fetch_with_accept "${BASE_URL}/" "text/markdown")
  content_type=$(echo "$headers" | grep -i '^content-type:' || true)
  if echo "$content_type" | grep -qi 'text/markdown'; then
    log_pass "Returns Content-Type: text/markdown on Accept: text/markdown"
  else
    log_fail "Does not return text/markdown (got: $(echo "$content_type" | tr -d '\r'))"
    log_info "  Fix: Cloudflare AI Crawl Control > Markdown for Agents toggle"
    log_info "  May require Cloudflare Pro plan"
  fi
fi

# --- Check 5: AI Bot Rules in robots.txt ---
log_section "Check 5: AI Bot Rules in robots.txt"
if [ -n "$BUILD_DIR" ]; then
  content=$(local_file_content "/robots.txt")
else
  content=$(fetch_body "${BASE_URL}/robots.txt")
fi

training_bots=("GPTBot" "ClaudeBot" "CCBot" "Google-Extended" "Google-CloudVertexBot" "Bytespider" "Meta-ExternalAgent" "Meta-ExternalFetcher" "Applebot-Extended" "Amazonbot")
search_agents=("OAI-SearchBot" "ChatGPT-User" "Claude-SearchBot" "Claude-User" "Perplexity-User")
missing_agents=()
for bot in "${training_bots[@]}" "${search_agents[@]}"; do
  if ! echo "$content" | tr -d '\r' | grep -Eqi "^User-agent:[[:space:]]*${bot}[[:space:]]*$"; then
    missing_agents+=("$bot")
  fi
done

if [ "${#missing_agents[@]}" -eq 0 ]; then
  log_pass "All ${#training_bots[@]} training and ${#search_agents[@]} search-agent rules found"
else
  log_fail "Missing expected AI crawler rules: ${missing_agents[*]}"
fi

unsupported_directives=$(printf '%s\n' "$content" | awk '
  {
    line = $0
    sub(/^[[:space:]]+/, "", line)
    if (line == "" || substr(line, 1, 1) == "#") next
    colon = index(line, ":")
    if (colon == 0) {
      print NR ": " line
      next
    }
    directive = tolower(substr(line, 1, colon - 1))
    gsub(/[[:space:]]/, "", directive)
    if (directive != "user-agent" && directive != "allow" && directive != "disallow" && directive != "sitemap") {
      print NR ": " line
    }
  }
')
if [ -z "$unsupported_directives" ]; then
  log_pass "robots.txt contains only the site-approved Lighthouse-safe directives"
else
  log_fail "robots.txt contains unsupported directives"
  log_info "$unsupported_directives"
fi

# --- Check 6: Content-Usage HTTP response header ---
log_section "Check 6: Content-Usage HTTP response header"
if [ -n "$BUILD_DIR" ]; then
  middleware_path="${SCRIPT_DIR}/../functions/_middleware.ts"
  static_headers_path="${SCRIPT_DIR}/../public/_headers"
  middleware_usage=$(sed -nE "s/^[[:space:]]*export const CONTENT_USAGE = ['\"]([^'\"]+)['\"][[:space:]]*$/\1/p" "$middleware_path" | head -1)
  static_usage=$(awk '
    $0 == "/*" { in_wildcard = 1; next }
    in_wildcard && $0 ~ /^\// { exit }
    in_wildcard && tolower($1) == "content-usage:" {
      sub(/^[^:]+:[[:space:]]*/, "")
      sub(/[[:space:]]*$/, "")
      print
      exit
    }
  ' "$static_headers_path")

  if [ "$middleware_usage" = "$EXPECTED_CONTENT_USAGE" ] && [ "$static_usage" = "$EXPECTED_CONTENT_USAGE" ]; then
    log_pass "Content-Usage is '$EXPECTED_CONTENT_USAGE' in middleware and the static wildcard"
  else
    log_fail "Content-Usage config mismatch (middleware='$middleware_usage', static wildcard='$static_usage')"
  fi
else
  usage_failures=()
  for usage_path in "/" "/privacy/" "/robots.txt"; do
    headers=$(fetch_headers "${BASE_URL}${usage_path}")
    usage_value=$(echo "$headers" | grep -i '^content-usage:' | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' || true)
    if [ "$usage_value" != "$EXPECTED_CONTENT_USAGE" ]; then
      usage_failures+=("${usage_path}='$usage_value'")
    fi
  done

  if [ "${#usage_failures[@]}" -eq 0 ]; then
    log_pass "Content-Usage is '$EXPECTED_CONTENT_USAGE' on live dynamic and static routes"
  else
    log_fail "Content-Usage live mismatch: ${usage_failures[*]}"
  fi
fi

# --- Check 7: API Catalog ---
log_section "Check 7: API Catalog (RFC 9727)"
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/.well-known/api-catalog"; then
    log_pass "api-catalog file exists in build output"
    # Validate JSON
    content=$(local_file_content "/.well-known/api-catalog")
    if echo "$content" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
      log_pass "api-catalog is valid JSON"
      if echo "$content" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'linkset' in d" 2>/dev/null; then
        log_pass "api-catalog contains 'linkset' key (RFC 9727)"
      else
        log_fail "api-catalog missing 'linkset' key"
      fi
    else
      log_fail "api-catalog is not valid JSON"
    fi
  else
    log_fail "api-catalog missing from build output"
  fi
else
  status=$(http_status "${BASE_URL}/.well-known/api-catalog")
  if [ "$status" = "200" ]; then
    log_pass "api-catalog returns 200"
    body=$(fetch_body "${BASE_URL}/.well-known/api-catalog")
    if echo "$body" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
      log_pass "api-catalog is valid JSON"
      if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'linkset' in d" 2>/dev/null; then
        log_pass "api-catalog contains 'linkset' key (RFC 9727)"
      else
        log_fail "api-catalog missing 'linkset' key"
      fi
      desc=$(echo "$body" | python3 -c "import sys,json; l=json.load(sys.stdin)['linkset']; assert any(e.get('item') for e in l); from urllib.parse import urlparse; print(urlparse(next(d['href'] for e in l for d in e.get('service-desc', []))).path)" 2>/dev/null || true)
      # The href names production; resolve its path against the target under test.
      if [ -n "$desc" ] && [ "$(http_status "${BASE_URL}${desc}")" = "200" ]; then
        log_pass "api-catalog lists an item whose service-desc resolves: $desc"
      else
        log_fail "api-catalog has no item, or its service-desc does not resolve"
      fi
    else
      log_fail "api-catalog body is not valid JSON"
    fi
    # Check Content-Type (RFC 9727 requires application/linkset+json)
    headers=$(fetch_headers "${BASE_URL}/.well-known/api-catalog")
    ct=$(echo "$headers" | grep -i '^content-type:' | tr -d '\r' || true)
    if echo "$ct" | grep -qi 'application/linkset+json'; then
      log_pass "Content-Type is application/linkset+json (RFC 9727 compliant)"
    else
      log_info "  Content-Type: $ct (expected application/linkset+json via Cloudflare Worker)"
      log_info "  Fix: Cloudflare Worker to override Content-Type to application/linkset+json"
      log_info "  Scanner may still pass on 200 + valid JSON body"
    fi
  else
    log_fail "api-catalog returns HTTP $status (expected 200)"
    log_info "  Fix: Deploy latest code to Cloudflare Pages"
  fi
fi

# --- Check 8: OAuth/OIDC Discovery ---
log_section "Check 8: OAuth/OIDC Discovery"
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/.well-known/openid-configuration"; then
    log_pass "openid-configuration exists"
  else
    log_skip "openid-configuration not present (N/A for static portfolio)"
  fi
else
  status=$(http_status "${BASE_URL}/.well-known/openid-configuration")
  if [ "$status" = "200" ]; then
    log_pass "openid-configuration returns 200"
  else
    log_skip "openid-configuration returns HTTP $status (N/A for static portfolio, no auth surface)"
  fi
fi

# --- Check 9: OAuth Protected Resource ---
log_section "Check 9: OAuth Protected Resource"
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/.well-known/oauth-protected-resource"; then
    log_pass "oauth-protected-resource exists"
  else
    log_skip "oauth-protected-resource not present (N/A for static portfolio)"
  fi
else
  status=$(http_status "${BASE_URL}/.well-known/oauth-protected-resource")
  if [ "$status" = "200" ]; then
    log_pass "oauth-protected-resource returns 200"
  else
    log_skip "oauth-protected-resource returns HTTP $status (N/A for static portfolio, no auth surface)"
  fi
fi

# --- Check 10: MCP Server Card and MCP endpoint ---
# SEP-2127 card at /mcp/server-card (canonical) and /.well-known/mcp/server-card.json
# (compatibility copy). The live run also connects: initialize, then tools/list, at the
# card's streamable-http remote. A card that only parses proves nothing about the server.
log_section "Check 10: MCP Server Card and MCP endpoint"
card_ok() {
  python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('\$schema', '').startswith('https://static.modelcontextprotocol.io/schemas/'), 'no SEP-2127 \$schema'
assert '/' in d.get('name', ''), 'name is not reverse-DNS'
assert 0 < len(d.get('description', '')) <= 100, 'description missing or over 100 characters'
assert any(r.get('type') == 'streamable-http' for r in d.get('remotes', [])), 'no streamable-http remote'
"
}
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/.well-known/mcp/server-card.json"; then
    log_pass "server-card.json exists in build output"
    if local_file_content "/.well-known/mcp/server-card.json" | card_ok 2>/dev/null; then
      log_pass "server-card.json has the SEP-2127 shape"
    else
      log_fail "server-card.json is not a SEP-2127 card"
    fi
  else
    log_fail "server-card.json missing from build output"
  fi
  log_info "/mcp and /mcp/server-card are Pages Functions -- verify after deploy, or under 'wrangler pages dev'"
else
  for card_path in /mcp/server-card /.well-known/mcp/server-card.json; do
    status=$(http_status "${BASE_URL}${card_path}")
    if [ "$status" = "200" ] && fetch_body "${BASE_URL}${card_path}" | card_ok 2>/dev/null; then
      log_pass "${card_path} returns a SEP-2127 card"
    else
      log_fail "${card_path} returns HTTP $status or not a SEP-2127 card"
    fi
  done
  ctype=$(fetch_headers "${BASE_URL}/mcp/server-card" | grep -i '^content-type:' | tr -d '\r' || true)
  if echo "$ctype" | grep -qi 'application/mcp-server-card+json'; then
    log_pass "/mcp/server-card served as application/mcp-server-card+json"
  else
    log_fail "/mcp/server-card Content-Type is '${ctype}'"
  fi
  mcp_url="${BASE_URL}/mcp"
  init=$(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' "$mcp_url" \
    --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"agent-readiness-check","version":"1"}}}' || true)
  tools=$(curl -s --max-time 15 -X POST -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'MCP-Protocol-Version: 2025-11-25' "$mcp_url" \
    --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' || true)
  rpc() { python3 -c "
import sys, json
text = sys.stdin.read()
lines = [l[5:].strip() for l in text.splitlines() if l.startswith('data:')]
print(json.dumps(json.loads(lines[-1] if lines else text)))
"; }
  if echo "$init" | rpc 2>/dev/null | python3 -c "import sys,json; r=json.load(sys.stdin)['result']; assert r['protocolVersion'] and r['serverInfo']['name']" 2>/dev/null; then
    log_pass "POST /mcp initialize returns a JSON-RPC result"
  else
    log_fail "POST /mcp initialize did not return a JSON-RPC result"
  fi
  if echo "$tools" | rpc 2>/dev/null | python3 -c "import sys,json; t=json.load(sys.stdin)['result']['tools']; assert t and all(x['annotations']['readOnlyHint'] is True for x in t); print(len(t))" >/tmp/agent-readiness-tools 2>/dev/null; then
    log_pass "POST /mcp tools/list returns $(cat /tmp/agent-readiness-tools) read-only tools"
  else
    log_fail "POST /mcp tools/list did not return read-only tools"
  fi
  get_status=$(http_status "$mcp_url")
  if [ "$get_status" = "405" ]; then
    log_pass "GET /mcp answers 405 (stateless Streamable HTTP, no GET stream)"
  else
    log_fail "GET /mcp answers HTTP $get_status (expected 405)"
  fi
fi

# --- Check 11: Agent Skills Index ---
log_section "Check 11: Agent Skills Index"
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/.well-known/agent-skills/index.json"; then
    log_pass "agent-skills/index.json exists in build output"
    content=$(local_file_content "/.well-known/agent-skills/index.json")
    if echo "$content" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
      log_pass "index.json is valid JSON"
      if echo "$content" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'skills' in d and len(d['skills']) > 0" 2>/dev/null; then
        log_pass "index.json has skills array with entries"
      else
        log_fail "index.json missing skills array or empty"
      fi
    else
      log_fail "index.json is not valid JSON"
    fi
    # Check SKILL.md
    if local_file_exists "/.well-known/agent-skills/portfolio-expert/SKILL.md"; then
      log_pass "SKILL.md exists in build output"
    else
      log_fail "SKILL.md missing from build output"
    fi
  else
    log_fail "agent-skills/index.json missing from build output"
  fi
else
  status=$(http_status "${BASE_URL}/.well-known/agent-skills/index.json")
  if [ "$status" = "200" ]; then
    log_pass "agent-skills/index.json returns 200"
    body=$(fetch_body "${BASE_URL}/.well-known/agent-skills/index.json")
    if echo "$body" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
      log_pass "index.json is valid JSON"
    else
      log_fail "index.json body is not valid JSON"
    fi
  else
    log_fail "agent-skills/index.json returns HTTP $status (expected 200)"
    log_info "  Fix: Deploy latest code to Cloudflare Pages"
  fi
  # Check SKILL.md
  skill_status=$(http_status "${BASE_URL}/.well-known/agent-skills/portfolio-expert/SKILL.md")
  if [ "$skill_status" = "200" ]; then
    log_pass "SKILL.md returns 200"
  else
    log_fail "SKILL.md returns HTTP $skill_status (expected 200)"
    log_info "  Fix: Deploy latest code to Cloudflare Pages"
  fi
fi

# --- Check 12: WebMCP ---
# WebMCP Draft CG Report 2026-10-02: document.modelContext.registerTool(tool), each tool
# annotated readOnlyHint: true. navigator.modelContext is only an origin-trial fallback,
# and provideContext() is not in the draft.
log_section "Check 12: WebMCP (document.modelContext.registerTool)"
if [ -n "$BUILD_DIR" ]; then
  page=$(local_file_content "/index.html")
  webmcp_source=$(local_file_content "/js/webmcp.js")
else
  page=$(fetch_body "${BASE_URL}/")
  webmcp_source=$(fetch_body "${BASE_URL}/js/webmcp.js")
fi
first_script=$(echo "$page" | grep -o '<script[^>]*>' | head -1)
if echo "$first_script" | grep -q 'src="/js/webmcp.js"'; then
  log_pass "webmcp.js is the first script on the page"
else
  log_fail "webmcp.js is not the first script (first: ${first_script})"
fi
if echo "$webmcp_source" | grep -q 'document.modelContext' && echo "$webmcp_source" | grep -q 'registerTool'; then
  log_pass "WebMCP script registers tools via document.modelContext.registerTool"
  tool_count=$(echo "$webmcp_source" | grep -o '"name":"[a-z_]*"' | sort -u | wc -l | tr -d ' ')
  readonly_count=$(echo "$webmcp_source" | grep -o '"readOnlyHint":true' | wc -l | tr -d ' ')
  if [ "$tool_count" -gt 0 ] && [ "$tool_count" = "$readonly_count" ]; then
    log_pass "  $tool_count tools, each with readOnlyHint: true"
  else
    log_fail "  $tool_count tools but $readonly_count readOnlyHint annotations"
  fi
  if echo "$webmcp_source" | grep -q 'provideContext'; then
    log_fail "  still calls provideContext(), which the draft does not define"
  fi
else
  log_fail "WebMCP script missing or does not use document.modelContext.registerTool"
fi

# --- Summary ---
echo ""
echo -e "${BOLD}========================================${NC}"
echo -e "${BOLD}  Agent Readiness Summary${NC}"
echo -e "${BOLD}========================================${NC}"
echo ""

# Calculate score (only non-skipped checks count)
scored=$((TOTAL - SKIP))
if [ "$scored" -gt 0 ]; then
  score=$((PASS * 100 / scored))
else
  score=0
fi

echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
echo -e "  ${YELLOW}SKIP: $SKIP${NC}"
echo -e "  Score: ${BOLD}${score}/100${NC} ($PASS/$scored checks)"
echo ""

if [ "$score" -ge 80 ]; then
  echo -e "  ${GREEN}Excellent! Site is largely agent-ready.${NC}"
elif [ "$score" -ge 50 ]; then
  echo -e "  ${YELLOW}Moderate. Several checks need attention.${NC}"
else
  echo -e "  ${RED}Needs work. Key discovery files or configs missing.${NC}"
fi

# Deployment check
if [ -z "$BUILD_DIR" ]; then
  echo ""
  log_section "Deployment Status"
  wf_status=$(http_status "${BASE_URL}/.well-known/api-catalog")
  if [ "$wf_status" = "404" ]; then
    echo -e "  ${RED}WARNING: .well-known files are NOT deployed!${NC}"
    echo -e "  .well-known files have not been deployed to Cloudflare Pages."
    echo -e "  Fix: Push to main to trigger deploy, or check GitHub Actions status."
  else
    echo -e "  ${GREEN}Deployment appears current.${NC}"
  fi
fi

echo ""
exit 0
