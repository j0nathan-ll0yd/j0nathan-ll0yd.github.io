---
name: verify-production
description: End-to-end production verification of the live Human Datastream site (jonathanlloyd.me). Probes well-known endpoints, CloudFront JSON sources, security/caching headers, PageSpeed, production smoke check, and live UX, then writes a structured report with severity-ranked findings. Triggers on "verify production", "verify the site", "production check", "prod healthcheck", "is the site working", "verify deploy", "check live site".
---

# Verify Production

You are running a **read-only** end-to-end verification of `https://jonathanlloyd.me` across six surfaces. Do not modify any source file, do not update any baseline, do not commit. Recommend fixes -- do not apply them. Write the report to `/tmp/prod-verification-<ISO-date>.md` AND echo it inline at the end.

Run surfaces 1-4 in parallel where possible (batched Bash). Surface 5 and 6 must run after surfaces 1-3 because they may pause for user input on failures.

## Step 1: Discovery / well-known endpoints

Run the canonical agent-readiness checker first:

```bash
bash scripts/agent-readiness-check.sh https://jonathanlloyd.me
```

Capture the PASS/FAIL/SKIP counts and the body of any failed check.

Then verify these additional invariants (batch into one Bash call):

```bash
# Link header on / must advertise three rel values
curl -sI https://jonathanlloyd.me/ | grep -i '^link:' | tee /tmp/vp-link.txt
# Expect substrings: rel="describedby", rel="api-catalog", rel="sitemap"

# Markdown negotiation -- middleware serves CloudFront llms-full.txt
curl -sI -H 'Accept: text/markdown' https://jonathanlloyd.me/ | grep -iE '^(content-type|cache-control|x-markdown-tokens):' | tee /tmp/vp-md.txt
# Expect: Content-Type: text/markdown, Cache-Control: no-store

# api-catalog Content-Type must include RFC 9727 profile
curl -sI https://jonathanlloyd.me/.well-known/api-catalog | grep -i '^content-type:' | tee /tmp/vp-catalog-ct.txt
# Expect: application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"

# MCP server-card must list exactly 10 resources
curl -s https://jonathanlloyd.me/.well-known/mcp/server-card.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('resources:', len(d['resources']))"
# Expect: resources: 10

# Agent Skills Discovery digest must match the live SKILL.md body
INDEX=$(curl -s https://jonathanlloyd.me/.well-known/agent-skills/index.json)
PINNED=$(echo "$INDEX" | python3 -c "import sys,json; print(json.load(sys.stdin)['skills'][0]['digest'])")
SKILL_URL=$(echo "$INDEX" | python3 -c "import sys,json; print(json.load(sys.stdin)['skills'][0]['url'])")
ACTUAL="sha256:$(curl -s "$SKILL_URL" | shasum -a 256 | awk '{print $1}')"
echo "pinned:  $PINNED"
echo "actual:  $ACTUAL"
# Expect: pinned == actual (drift here breaks Agent Skills Discovery v0.2.0)

# Static discovery resources must all return 200
for path in /llms.txt /robots.txt /sitemap-index.xml /manifest.webmanifest; do
  printf "%-22s %s\n" "$path" "$(curl -sI "https://jonathanlloyd.me$path" | head -1)"
done
# Expect: all 200
```

Score this surface PASS only if all `agent-readiness-check.sh` checks pass AND every additional invariant matches. SHA-256 digest drift is a CRITICAL finding -- it silently breaks agent discovery.

## Step 2: CloudFront JSON data sources

The dashboard polls 13 CloudFront resources at runtime: **10 JSON endpoints** plus **3 text/markdown documents** (`llms-small.txt`, `llms-full.txt`, `index.md`). Only the 10 JSON files need shape validation.

```bash
BASE=https://d1pfm520aduift.cloudfront.net
JSON_FILES="health sleep focus github-events github-starred-repos books articles theatre-reviews workouts location"
TEXT_FILES="llms-small.txt llms-full.txt index.md"

for f in $JSON_FILES; do
  url="$BASE/$f.json"
  hdr=$(curl -sI "$url")
  code=$(echo "$hdr" | head -1 | awk '{print $2}')
  cc=$(echo "$hdr" | grep -i '^cache-control:' | tr -d '\r')
  body=$(curl -s "$url")
  size=$(echo -n "$body" | wc -c)
  parses=$(echo "$body" | python3 -c "import sys,json; json.load(sys.stdin); print('ok')" 2>/dev/null || echo "INVALID")
  stamp=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); ts=d.get('updatedAt') or d.get('generatedAt') or d.get('asOf') or ''; print(ts)" 2>/dev/null)
  printf "%-22s status=%s bytes=%s parses=%s s-maxage=%s stamp=%s\n" "$f.json" "$code" "$size" "$parses" "$(echo $cc | grep -oE 's-maxage=[0-9]+')" "$stamp"
done

for f in $TEXT_FILES; do
  url="$BASE/$f"
  hdr=$(curl -sI "$url")
  code=$(echo "$hdr" | head -1 | awk '{print $2}')
  cc=$(echo "$hdr" | grep -i '^cache-control:' | tr -d '\r')
  size=$(curl -s "$url" | wc -c)
  printf "%-22s status=%s bytes=%s s-maxage=%s\n" "$f" "$code" "$size" "$(echo $cc | grep -oE 's-maxage=[0-9]+')"
done
```

For each endpoint, verify: HTTP 200, non-empty body, and `Cache-Control` contains `s-maxage=30` (intentional: matches the PollEngine fast-poll interval; confirmed with the Mantle stack owner 2026-06-07). For JSON endpoints, also verify the body parses. Compare timestamp fields against `date -u +%s` -- flag anything older than 24h.

**Important:** Data staleness on a CloudFront JSON points at the **upstream Lifegames Portal backend** (a separate repository), NOT at this deploy. Frame stale-data findings as upstream issues in the report and do not recommend changes to this repo for them.

## Step 3: Security & caching headers

Fetch the homepage headers and validate against `functions/_middleware.ts`. The middleware -- not `public/_headers` -- is the source of truth because root middleware disables `_headers` processing.

```bash
# Homepage headers
curl -sI https://jonathanlloyd.me/ > /tmp/vp-home-headers.txt
cat /tmp/vp-home-headers.txt
```

Verify:

- `Content-Security-Policy:` matches the policy assembled in `functions/_middleware.ts:5-16`. In particular `connect-src` MUST include `'self'`, `https://d1pfm520aduift.cloudfront.net`, and `wss://iu1k9jv4mi.execute-api.us-west-2.amazonaws.com`. `script-src` MUST include `https://scripts.simpleanalyticscdn.com` and `https://static.cloudflareinsights.com`. `script-src` MUST NOT contain `'unsafe-inline'` (PR #37 removed it by externalizing all inline scripts to `public/js/`; a regression here re-opens an XSS attack surface). `style-src` retaining `'unsafe-inline'` is currently expected; flag only as INFORMATIONAL once it is also removed upstream.
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `CDN-Cache-Control: no-store` -- the homepage MUST bypass edge cache so content negotiation works. This is invariant per `CLAUDE.md` Caching Architecture.

Probe the 404 regression (PRs #27 and #29 -- 4xx and SPA-fallback responses must replace the HTML body and must NOT be cached):

```bash
curl -sI https://jonathanlloyd.me/nope-xyz-$RANDOM > /tmp/vp-404-headers.txt
curl -s  https://jonathanlloyd.me/nope-xyz-$RANDOM | head -c 200
echo
cat /tmp/vp-404-headers.txt
```

Verify: status `404` and the body is the custom 404 page (look for the dashboard's 404 marker text), NOT the SPA shell. Note: Cloudflare Pages free tier re-applies a default `Cache-Control: max-age=600` on 4xx HTML regardless of Function-set headers (proved empirically in PR #31 / commit `f8a34d8` -- directive: do not reintroduce middleware-level 4xx cache-control rewrites; the fix belongs upstream). Do NOT flag `max-age=600` here as a finding. Only flag if `cf-cache-status: HIT` appears on the first request, which would indicate genuine edge caching beyond the browser-level TTL.

Probe `/_astro/*` immutability:

```bash
ASTRO_URL=$(curl -s https://jonathanlloyd.me/ | grep -oE '/_astro/[a-zA-Z0-9._-]+\.(js|css|woff2?)' | head -1)
echo "asset: $ASTRO_URL"
curl -sI "https://jonathanlloyd.me${ASTRO_URL}" | grep -i '^cache-control:'
```

The `Cache-Control` header MUST contain BOTH `max-age=31536000` AND `immutable`. Anything weaker is a HIGH finding -- it bloats client transfer on every deploy.

Probe the PWA service worker activation lifecycle:

```bash
# The Workbox-generated SW MUST contain both self.skipWaiting() and clientsClaim()
# so a freshly-deployed SW activates on the next page load and claims existing
# tabs. Without these, returning visitors get stuck on the precached old HTML
# until they manually close every tab -- which historically meant a CSS or JS
# fix would appear "deployed" via curl but invisible to real users for days.
SW_BODY=$(curl -s 'https://jonathanlloyd.me/sw.js?cb='$(date +%s))
echo "$SW_BODY" | grep -oE 'self\.skipWaiting|clientsClaim' | sort -u
# Expect both lines: clientsClaim AND self.skipWaiting
```

If either directive is missing this is a HIGH finding -- track it back to `astro.config.mjs` `AstroPWA({ workbox: { skipWaiting: true, clientsClaim: true } })`. A regression here silently re-introduces the "fix is deployed but users still see the old version" failure mode.

## Step 4: PageSpeed Insights (Core Web Vitals)

Requires the `PSI_API_KEY` environment variable (Google Cloud Console -> PageSpeed Insights API; free quota is 25k req/day authenticated, anonymous quota is effectively 0). Without the key, this surface is SKIPPED (not FAIL) -- the verification verdict gates on PSI only when the key is present.

```bash
if [ -z "$PSI_API_KEY" ]; then
  echo "[SKIP] PSI_API_KEY not set -- surface 4 will be skipped" > /tmp/vp-psi-status.txt
else
  PSI="https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https://jonathanlloyd.me&key=${PSI_API_KEY}"
  CATS="&category=performance&category=accessibility&category=best-practices&category=seo"

  curl -sL "${PSI}&strategy=mobile${CATS}"  > /tmp/vp-psi-mobile.json
  curl -sL "${PSI}&strategy=desktop${CATS}" > /tmp/vp-psi-desktop.json

  # If the API returns 429 or RESOURCE_EXHAUSTED, hard SKIP with a quota note
  if grep -q 'RESOURCE_EXHAUSTED\|"code": 429' /tmp/vp-psi-mobile.json /tmp/vp-psi-desktop.json 2>/dev/null; then
    echo "[SKIP] PSI quota exhausted (429 / RESOURCE_EXHAUSTED) -- surface 4 will be skipped" > /tmp/vp-psi-status.txt
  else
    for f in mobile desktop; do
      python3 - <<PY
import json
d = json.load(open('/tmp/vp-psi-$f.json'))
lr = d.get('lighthouseResult', {})
cats = lr.get('categories', {})
audits = lr.get('audits', {})
scores = {k: int(round((cats.get(k, {}).get('score') or 0) * 100)) for k in ['performance','accessibility','best-practices','seo']}
lcp = audits.get('largest-contentful-paint', {}).get('numericValue', 0) / 1000
cls = audits.get('cumulative-layout-shift', {}).get('numericValue', 0)
tbt = audits.get('total-blocking-time', {}).get('numericValue', 0)
print(f"[$f] perf={scores['performance']} a11y={scores['accessibility']} bp={scores['best-practices']} seo={scores['seo']} LCP={lcp:.2f}s CLS={cls:.3f} TBT={tbt:.0f}ms")

# Surface why the score is not 100: rank failing audits across all four categories
# by their weighted impact (audit weight * (1 - score)). Includes opportunity savings
# when present so the report links each failing audit to a concrete fix and cost.
weighted = []
for cat_key, cat in cats.items():
    for ref in cat.get('auditRefs', []) or []:
        weight = ref.get('weight', 0) or 0
        if weight <= 0:
            continue
        aud = audits.get(ref.get('id'), {})
        score = aud.get('score')
        mode = aud.get('scoreDisplayMode', '')
        if score is None or mode in ('notApplicable', 'manual', 'informative'):
            continue
        if score >= 1:
            continue
        savings_ms = (aud.get('details') or {}).get('overallSavingsMs')
        savings_bytes = (aud.get('details') or {}).get('overallSavingsBytes')
        weighted.append({
            'cat': cat_key,
            'id': aud.get('id'),
            'title': aud.get('title', ''),
            'score': score,
            'weight': weight,
            'impact': weight * (1 - score),
            'display': aud.get('displayValue') or '',
            'savings_ms': savings_ms,
            'savings_bytes': savings_bytes,
        })
weighted.sort(key=lambda x: x['impact'], reverse=True)
top = weighted[:8]
if top:
    print(f"[$f] top failing audits:")
    for a in top:
        extras = []
        if a['display']:
            extras.append(a['display'])
        if a['savings_ms']:
            extras.append(f"save {int(a['savings_ms'])}ms")
        if a['savings_bytes']:
            extras.append(f"save {int(a['savings_bytes']/1024)}KB")
        suffix = f" ({'; '.join(extras)})" if extras else ''
        print(f"  - [{a['cat']}] {a['id']}: {a['title']}{suffix}")
PY
    done
  fi
fi
```

Targets:

| Metric | Mobile | Desktop |
|---|---|---|
| Performance | >= 90 | >= 95 |
| Accessibility | >= 95 | >= 95 |
| Best Practices | >= 95 | >= 95 |
| SEO | >= 95 | >= 95 |
| LCP | <= 2.5s | <= 2.5s |
| CLS | <= 0.1 | <= 0.1 |
| TBT | <= 200ms | <= 200ms |

The python parser above emits the **top 8 failing audits per strategy** ranked by category-weighted impact (`weight * (1 - score)`) with `displayValue`, estimated time savings (`overallSavingsMs`), and estimated byte savings (`overallSavingsBytes`) when present. Include every audit listed under `top failing audits` in the Step 7 Recommendations -- each one is a concrete reason the score is not 100. Common offenders: `unused-javascript`, `render-blocking-resources`, `modern-image-formats`, `unminified-javascript`, `uses-text-compression`, `color-contrast`, `tap-targets`.

## Step 5: Production smoke check against the deployed dashboard

```bash
npx playwright test --config=playwright.smoke.config.ts 2>&1 | tee /tmp/vp-smoke.log
```

This asserts the live site actually **hydrated** -- HTTP 200, every widget container present, the live-data runtime cleared its skeleton states, the bio terminal typed its content (the #50 CSP-blocked-hydration regression class), the service worker registered, and no CSP / chunk-load / console errors fired. It runs natively (no Docker, no pixel baselines), so there is nothing to SKIP on a clean checkout.

A failure here is high-signal -- it means a real deploy/hydration regression, not data churn. Include the failing assertion from the log in the report. The smoke check replaced the retired pixel-drift suite, which could not stay green against a live data stream and could not catch a blocked-hydration regression (the SSR shell still renders at the right pixels).

## Step 6a: Mobile-viewport probe (Playwright iPhone 13 emulation)

BrowserOS cannot resize its window below ~795px so mobile-specific failures (page-scroll, innerHTML-inserted widget opacity, etc.) slip past Surface 6 unless you emulate explicitly. Run this probe against the **live** site -- it catches the two regression classes that previously shipped to production unnoticed:

1. **Page-level scroll** -- a regression that re-applies `overflow: hidden` to `html, body` without gating it behind `@media (min-width: 1100px)` makes the entire dashboard unscrollable on mobile (PR #40).
2. **innerHTML-inserted widget opacity** -- updaters that swap content via `body.innerHTML = html` (Reading Feed, others) can leave items stuck at the `from { opacity: 0 }` keyframe because Chrome registers but never schedules the CSS animation. Playwright's regression suite cannot catch this because `animations: 'disabled'` fast-forwards to the final keyframe, masking the bug (PR #42).

Write a one-shot probe to `/tmp/vp-mobile-probe.mjs`, run it from the project root so it resolves `playwright`, and parse the JSON it prints:

```bash
cat > /tmp/vp-mobile-probe.mjs <<'EOF'
import { chromium, devices } from 'playwright';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
await page.goto('https://jonathanlloyd.me/?cb=' + Date.now(), { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(8000); // let the live-data updater swap reading feed innerHTML
await page.evaluate(() => document.getElementById('cardReading')?.scrollIntoView());
await page.waitForTimeout(1500);

const report = await page.evaluate(() => {
  const html = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  // 1) page-level scroll -- mobile MUST be able to scroll past the fold.
  // At iPhone widths, with html+body height:100dvh + overflow:auto, BODY
  // (not html) is the scroll container -- body.scrollHeight grows with
  // content while html stays clamped to the viewport. Check both: neither
  // axis must be `overflow:hidden`, AND content height must exceed viewport
  // height somewhere. Programmatic scrollTo() probes are unreliable under
  // emulation, so this checks the STATE that determines scrollability.
  const scrollProbe = (() => {
    // Note: `body` and `html` above are CSSStyleDeclaration objects -- use
    // document.body / document.documentElement to read DOM measurements.
    const overflowingContent = document.body.scrollHeight > innerHeight + 200
      || document.documentElement.scrollHeight > innerHeight + 200;
    const blocked = html.overflowY === 'hidden' || body.overflowY === 'hidden';
    return { overflowingContent, blocked };
  })();
  // 2) reading-feed item opacity -- innerHTML-inserted items MUST end visible
  const items = [...document.querySelectorAll('#cardReading .article-list-item')];
  const sample = items.slice(0, 3).map((it) => parseFloat(getComputedStyle(it).opacity));
  return {
    innerW: innerWidth,
    htmlOverflow: html.overflow,
    bodyOverflow: body.overflow,
    bodyScrollH: document.body.scrollHeight,
    pageScrolls: !scrollProbe.blocked && scrollProbe.overflowingContent,
    readingItemCount: items.length,
    readingOpacities: sample,
    readingAllVisible: items.length > 0 && sample.every((o) => o > 0.5),
  };
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
EOF
cp /tmp/vp-mobile-probe.mjs ./vp-mobile-probe.mjs
node vp-mobile-probe.mjs | tee /tmp/vp-mobile-probe.json
rm -f ./vp-mobile-probe.mjs
```

Verify and classify:

- `pageScrolls === true` -- if false, `html, body { overflow: hidden }` has leaked outside the `@media (min-width: 1100px)` gate in `src/layouts/Dashboard.astro`. **CRITICAL** -- the entire dashboard is unreachable past the first viewport.
- `htmlOverflow` and `bodyOverflow` are NOT `hidden` (expected `auto` or `visible`) at iPhone 13 width.
- `readingItemCount >= 8` -- the updater fired and inserted items.
- `readingAllVisible === true` -- every probed item has `opacity > 0.5`. If items report `opacity: 0` while `readingItemCount > 0`, the innerHTML+animation race has regressed. **HIGH** -- the Reading Feed body looks empty even though pagination renders. The fix lives in the un-layered `.article-list-item { opacity: 1 }` rule in `src/layouts/Dashboard.astro`.

If the probe cannot reach the production URL (network failure, DNS), report this surface as **SKIP** and continue.

## Step 6b: Live UX verification (BrowserOS MCP)

Drive the live site via BrowserOS MCP. The discovery protocol is **take_snapshot -> act -> re-snapshot**. After any navigation, element IDs become invalid and a fresh snapshot is required.

1. `mcp__browseros__new_page` with `https://jonathanlloyd.me`.
2. `mcp__browseros__take_snapshot` -- confirm the document body renders. A blank body, the SPA fallback shell, or a "Failed to load" overlay is a CRITICAL finding.
3. `mcp__browseros__get_console_logs` -- enumerate errors and warnings. A CSP violation is CRITICAL. Any uncaught JS exception is HIGH.
4. `mcp__browseros__evaluate_script` with the following expression and record each value:

   ```javascript
   ({
     triCards: document.querySelectorAll('.tri-card').length,
     hasHeartRate: !!document.querySelector('#cardHR'),
     heartRateHydrated: !document.querySelector('#cardHR')?.classList.contains('is-loading'),
     responseEnd: performance.getEntriesByType('navigation')[0]?.responseEnd,
     cspViolations: 'see console logs',
   })
   ```

   Wait ~10s before re-evaluating `heartRateHydrated` so the poll engine has a chance to fetch data.

   Targets:
   - `triCards >= 11` (post-DailyActivity retirement, PR #33 + #35; production renders 11 widgets)
   - `hasHeartRate === true`
   - `heartRateHydrated === true` after 10s
   - `responseEnd < 2000` (ms)

5. `mcp__browseros__take_screenshot` and save to `/tmp/verify-prod-$(date -u +%Y%m%dT%H%M%SZ).png`. Include the path in the report.
6. Note from the CSP probe whether `connect-src` allows `wss://iu1k9jv4mi.execute-api.us-west-2.amazonaws.com`; cross-reference any "WebSocket connection failed" entries from `get_console_logs`.

If BrowserOS is unreachable: fall back to `curl -s https://jonathanlloyd.me/ | grep -oE 'tri-card' | wc -l` for a coarse widget count, and state explicitly in the report: "Surface 6 (live UX) skipped -- BrowserOS unavailable."

## Step 7: Write the report

Write `/tmp/prod-verification-$(date -u +%Y-%m-%d).md` AND echo it inline. Use this exact structure:

```markdown
# Production Verification -- jonathanlloyd.me -- <ISO date>

## Verdict: PASS | DEGRADED | FAIL

<one-line summary>

## Surface results

| Surface | Status | Notes |
|---|---|---|
| 1. Discovery (well-known) | PASS/DEGRADED/FAIL/SKIP | <agent-readiness PASS count, plus any additional probe failures> |
| 2. CloudFront JSON | ... | <stale endpoints, parse failures> |
| 3. Security/caching headers | ... | <CSP/CDN-CC/404/_astro state> |
| 4. PageSpeed mobile/desktop | ... | <perf scores, key vitals> |
| 5. Smoke check | ... | <PASS or FAIL + failing assertion> |
| 6a. Mobile probe (Playwright iPhone 13) | ... | <pageScrolls, reading-feed item opacity> |
| 6b. Live UX (BrowserOS) | ... | <widget count, console errors, navigation timing> |

## Findings (severity-ranked)

### CRITICAL
- ...

### HIGH
- ...

### MEDIUM
- ...

### INFORMATIONAL
- ...

## Recommendations

For each finding above, give: file:line of the likely fix, the specific change, and the classification:
- **config** -- Cloudflare dashboard, CDN settings, DNS
- **code** -- `functions/_middleware.ts`, `astro.config.mjs`, `src/`, etc.
- **content** -- `data/*.json`, `public/.well-known/`
- **upstream** -- Lifegames Portal backend (separate repo, out of scope for this site)

## Evidence

- `agent-readiness-check.sh` output: <inline or attach>
- PSI mobile summary: <key scores>
- PSI desktop summary: <key scores>
- Smoke check: <PASS or FAIL + failing assertion>
- Live screenshot: <path>
- Console log dump: <inline if non-empty>
```

### Verdict thresholds

- **PASS** -- zero CRITICAL findings, zero HIGH findings, all surfaces score PASS or SKIP.
- **DEGRADED** -- zero CRITICAL findings, but at least one HIGH finding OR at least one surface DEGRADED (e.g., PSI under target).
- **FAIL** -- one or more CRITICAL findings (CSP violation, agent-skills digest drift, broken homepage render, no-store missing from `/`, 404 cached, asset 404s wrong body, missing well-known endpoint, **unscrollable mobile dashboard** from Step 6a).

## Key Constraints

- **Read-only.** Never edit source files. Never run `npm run test:visual:update:docker` or `npx playwright test --update-snapshots` — baseline regen is a deliberate action that belongs to the author of the visual change, not to verification. Never commit. Recommend fixes -- do not apply them.
- **Parallel where possible.** Batch independent curl probes in a single Bash invocation. Surfaces 1, 2, 3 are independent; surface 4 (PSI) is independent and slow; surface 5 (Playwright) and surface 6 (BrowserOS) must run sequentially after the curl surfaces.
- **Middleware is the header source of truth.** Root middleware disables `public/_headers`. When a header looks wrong, the root cause is almost always `functions/_middleware.ts`.
- **Data freshness != deploy freshness.** A stale CloudFront JSON points at the upstream Lifegames Portal backend, not at this deploy. Classify those findings as **upstream**.
- **No emojis** anywhere in the report.
- **Default autonomy** is `[AFK]`. Only pause for user input if a critical surface (the homepage `/`) is unreachable.
