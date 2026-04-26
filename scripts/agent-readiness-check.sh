#!/bin/bash
# Agent Readiness Local Validator
# Tests all 12 checks from isitagentready.com against a target URL.
# Usage: ./scripts/agent-readiness-check.sh [URL] [BUILD_DIR]
#   URL       - Site to test (default: https://jonathanlloyd.me)
#   BUILD_DIR - Local build output to test (default: none, uses live URL)
#
# When BUILD_DIR is provided, tests are run against local files via
# a temporary HTTP server. This catches deployment issues before pushing.

set -euo pipefail

# --- Configuration ---
TARGET_URL="${1:-https://jonathanlloyd.me}"
BUILD_DIR="${2:-}"
BASE_URL="$TARGET_URL"
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
    echo "Run 'npm run build' first, then: $0 https://example.com ./dist"
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
  else
    log_fail "No Link header on GET /"
    log_info "  Fix: Cloudflare Transform Rule > Modify Response Header"
    log_info "  Value: </llms.txt>; rel=\"describedby\"; type=\"text/plain\", </.well-known/api-catalog>; rel=\"api-catalog\", </sitemap-index.xml>; rel=\"sitemap\""
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

ai_bots=("GPTBot" "ClaudeBot" "CCBot" "Google-Extended" "anthropic-ai" "Bytespider" "Meta-ExternalAgent" "Applebot-Extended" "Amazonbot")
found_bots=0
for bot in "${ai_bots[@]}"; do
  if echo "$content" | grep -q "User-agent: $bot"; then
    found_bots=$((found_bots + 1))
  fi
done

if [ "$found_bots" -ge 3 ]; then
  log_pass "AI bot rules found ($found_bots/${#ai_bots[@]} bots configured)"
else
  log_fail "Few AI bot rules found ($found_bots/${#ai_bots[@]} bots, need 3+)"
fi

# --- Check 6: Content Signals in robots.txt ---
log_section "Check 6: Content Signals in robots.txt"
if echo "$content" | grep -qi 'Content-Signal:'; then
  signal_line=$(echo "$content" | grep -i 'Content-Signal:' | head -1 | tr -d '\r')
  log_pass "Content-Signal directive found: $signal_line"
  # Verify signals
  if echo "$signal_line" | grep -qi 'ai-train=no'; then
    log_info "  ai-train=no (training blocked)"
  fi
  if echo "$signal_line" | grep -qi 'ai-input=yes'; then
    log_info "  ai-input=yes (RAG/grounding allowed)"
  fi
  if echo "$signal_line" | grep -qi 'search=yes'; then
    log_info "  search=yes (search indexing allowed)"
  fi
else
  log_fail "No Content-Signal directive in robots.txt"
  log_info "  Fix: Add 'Content-Signal: search=yes, ai-train=no, ai-input=yes' under User-agent: *"
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

# --- Check 10: MCP Server Card ---
log_section "Check 10: MCP Server Card"
if [ -n "$BUILD_DIR" ]; then
  if local_file_exists "/.well-known/mcp/server-card.json"; then
    log_pass "server-card.json exists in build output"
    content=$(local_file_content "/.well-known/mcp/server-card.json")
    if echo "$content" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
      log_pass "server-card.json is valid JSON"
      if echo "$content" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'resources' in d or 'capabilities' in d" 2>/dev/null; then
        log_pass "server-card.json has resources or capabilities"
      else
        log_fail "server-card.json missing resources/capabilities"
      fi
    else
      log_fail "server-card.json is not valid JSON"
    fi
  else
    log_fail "server-card.json missing from build output"
  fi
else
  status=$(http_status "${BASE_URL}/.well-known/mcp/server-card.json")
  if [ "$status" = "200" ]; then
    log_pass "server-card.json returns 200"
    body=$(fetch_body "${BASE_URL}/.well-known/mcp/server-card.json")
    if echo "$body" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
      log_pass "server-card.json is valid JSON"
    else
      log_fail "server-card.json body is not valid JSON"
    fi
  else
    log_fail "server-card.json returns HTTP $status (expected 200)"
    log_info "  Fix: Deploy latest code to Cloudflare Pages"
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
log_section "Check 12: WebMCP (navigator.modelContext)"
if [ -n "$BUILD_DIR" ]; then
  # Check if the inline script contains modelContext
  index_html=$(local_file_content "/index.html")
  if echo "$index_html" | grep -q 'navigator.modelContext'; then
    log_pass "WebMCP script found in index.html (navigator.modelContext)"
    if echo "$index_html" | grep -q 'provideContext'; then
      log_pass "  Uses provideContext() API"
    fi
    if echo "$index_html" | grep -q 'get_profile\|get_data_sources\|get_current_reading\|get_tech_stack'; then
      tool_count=$(echo "$index_html" | grep -o "name: '[a-z_]*'" | wc -l | tr -d ' ')
      log_pass "  $tool_count tools registered"
    fi
  else
    log_fail "WebMCP script not found in index.html"
  fi
else
  body=$(fetch_body "${BASE_URL}/")
  if echo "$body" | grep -q 'navigator.modelContext'; then
    log_pass "WebMCP script found in page source (navigator.modelContext)"
    if echo "$body" | grep -q 'provideContext'; then
      log_pass "  Uses provideContext() API"
    fi
    tool_count=$(echo "$body" | grep -o "name: '[a-z_]*'" | wc -l | tr -d ' ')
    if [ "$tool_count" -gt 0 ]; then
      log_pass "  $tool_count tools registered"
    fi
  else
    log_fail "WebMCP script not found in page source"
    log_info "  Fix: Deploy latest code to Cloudflare Pages"
  fi
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
