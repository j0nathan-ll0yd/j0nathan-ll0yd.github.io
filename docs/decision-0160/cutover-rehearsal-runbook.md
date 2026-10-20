# Cutover and rollback rehearsal runbook (atlas decision 0160, plan Step 0.4)

Status: written for PR A, NOT executed. Step 0.4 is `[TEST] [SUPERVISED]`: it writes DNS records,
Workers routes and custom domains in the `jonathanlloyd.me` zone, so the owner runs it, or
supervises an agent that holds a token for it. It touches only a disposable hostname and throwaway
projects. It never touches `jonathanlloyd.me`, `www`, the `human-datastream` Pages project or the
`human-datastream` Worker.

The rehearsal settles decision 0160 D7: zero planned downtime if the overlap route works, otherwise
at most 5 minutes of errors in a scheduled window. Record every result in the table at the end and
copy it to the atlas evidence folder (`decisions/evidence/0160-server-side-rendering/`).

## What it proves

1. **Overlap route.** A Workers Route on a proxied hostname answers from the Worker while the
   hostname's DNS record still points at Pages. No document covers a record that points at Pages
   (plan, lane F claim 2), so this is the open question.
2. **Custom Domain path.** Cloudflare refuses a Workers Custom Domain on a hostname that has a CNAME
   (lane F claim 1). The record must go first; the gap until a valid certificate serves is the
   error window.
3. **Rollback, each way.** Back to Pages from each mechanism, and `wrangler rollback` between two
   Worker versions.

Every response carries a marker: the Worker answers `X-Site-Runtime: workers` and
`/version.json` `{"runtime":"workers"}`; Pages answers neither.

## Names

| Thing                   | Value                                         |
| ----------------------- | --------------------------------------------- |
| Disposable hostname     | `pr-a-rehearsal.jonathanlloyd.me`             |
| Throwaway Pages project | `pr-a-rehearsal` (`pr-a-rehearsal.pages.dev`) |
| Throwaway Worker        | `pr-a-rehearsal`                              |
| Zone                    | `jonathanlloyd.me` (`$CLOUDFLARE_ZONE_ID`)    |
| Account                 | `$CLOUDFLARE_ACCOUNT_ID`                      |

## Credentials

One API token for the rehearsal only, revoked at teardown. Permission groups:

- Account > Workers Scripts > Edit (Worker upload, versions, deployments, custom domains)
- Account > Cloudflare Pages > Edit (throwaway Pages project, its custom domain)
- Zone > Workers Routes > Edit, on `jonathanlloyd.me` (the overlap route)
- Zone > DNS > Edit, on `jonathanlloyd.me` (the disposable record)

Whether a Workers Custom Domain needs Zone > DNS > Edit in addition to Workers Scripts > Edit is
UNVERIFIED in the docs; the token above carries both, so the rehearsal answers it. Record which
calls succeed.

```bash
export CLOUDFLARE_API_TOKEN=...        # the rehearsal token
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_ZONE_ID=...
export HOST=pr-a-rehearsal.jonathanlloyd.me
export CF=https://api.cloudflare.com/client/v4
cf() { curl -sS --fail-with-body -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$@"; }
```

## The probe

Run it in a second terminal for every phase. It writes one line a second: UTC time, status,
platform marker, and a curl error when the request fails. The error window is the span of lines
whose status is not 200 or whose marker is not the expected one.

```bash
probe() {  # usage: probe <label>; Ctrl-C to stop
  while true; do
    out=$(curl -sS -o /dev/null --max-time 5 -D - "https://$HOST/" 2>&1)
    code=$(printf '%s\n' "$out" | awk 'NR==1{print $2}')
    rt=$(printf '%s\n' "$out" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-site-runtime"{print $2}')
    err=$(printf '%s\n' "$out" | grep -m1 '^curl:' || true)
    printf '%s %s code=%s runtime=%s %s\n' "$(date -u +%H:%M:%S)" "$1" "${code:-none}" "${rt:-pages}" "$err"
    sleep 1
  done | tee -a "/tmp/pr-a-rehearsal-$1.log"
}
```

## Phase 0: set up the throwaway Pages project on the disposable hostname

Build `origin/main` (the Pages build) in a clean worktree, then deploy it as a new Pages project.

```bash
git worktree add --detach /tmp/pr-a-rehearsal-main origin/main
cd /tmp/pr-a-rehearsal-main && pnpm install --frozen-lockfile && pnpm build
pnpm exec wrangler pages project create pr-a-rehearsal --production-branch main
pnpm exec wrangler pages deploy dist --project-name pr-a-rehearsal --branch main
# Attach the custom domain to the Pages project, then point DNS at it (proxied).
cf -X POST "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/pr-a-rehearsal/domains" --data "{\"name\":\"$HOST\"}"
cf -X POST "$CF/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  --data "{\"type\":\"CNAME\",\"name\":\"$HOST\",\"content\":\"pr-a-rehearsal.pages.dev\",\"proxied\":true,\"comment\":\"decision 0160 Step 0.4 rehearsal; delete at teardown\"}"
```

Expected: within minutes, `GET /api/.../pages/projects/pr-a-rehearsal/domains/$HOST` reports
`status: active`, and `probe setup` prints `code=200 runtime=pages`. Record the DNS record id
(`RECORD_ID`) from the response.

## Phase 1: create the throwaway Worker, two versions

Build the PR A branch twice, with two build stamps, so each version names itself in
`/version.json` (`scripts/write-version.mjs` reads `GITHUB_SHA`).

```bash
cd <PR A worktree>
GITHUB_SHA=rehearsal-v1 pnpm build
pnpm exec wrangler deploy --name pr-a-rehearsal --message "rehearsal v1"   # V1
GITHUB_SHA=rehearsal-v2 pnpm build
pnpm exec wrangler versions upload --name pr-a-rehearsal --message "rehearsal v2"   # V2, not deployed
pnpm exec wrangler versions list --name pr-a-rehearsal
```

Expected: `wrangler deploy` warns that the Worker has no deploy targets (no route, no custom
domain, `workers_dev: false`) and still creates it with V1 active. Record both version ids
(`V1`, `V2`). No hostname serves the Worker yet: `probe setup` still prints `runtime=pages`.

## Phase 2: the overlap route (DNS still points at Pages)

```bash
probe overlap   # second terminal
cf -X POST "$CF/zones/$CLOUDFLARE_ZONE_ID/workers/routes" --data "{\"pattern\":\"$HOST/*\",\"script\":\"pr-a-rehearsal\"}"
```

Expected if the overlap works: the probe flips from `runtime=pages` to `runtime=workers` with no
line in between that is not 200. Then check the whole site through the route:

```bash
node scripts/worker-parity.mjs --baseline https://pr-a-rehearsal.pages.dev --candidate "https://$HOST"
curl -s "https://$HOST/version.json"   # {"build":"rehearsal-v1",...,"runtime":"workers"}
```

Record: the flip time, every non-200 line, the parity result. If the route does NOT take effect
(the probe stays on `runtime=pages` for 5 minutes), record that: the overlap path is not
available, and D7 falls back to the scheduled window.

### Rollback 2a: route off, back to Pages

```bash
ROUTE_ID=$(cf "$CF/zones/$CLOUDFLARE_ZONE_ID/workers/routes" | node -pe "JSON.parse(require('fs').readFileSync(0)).result.find(r=>r.pattern==='$HOST/*').id")
cf -X DELETE "$CF/zones/$CLOUDFLARE_ZONE_ID/workers/routes/$ROUTE_ID"
```

Expected: the probe flips back to `runtime=pages` with no non-200 line. Record the window.

## Phase 3: `wrangler rollback` between two Worker versions

With the route back on (repeat the Phase 2 `POST`):

```bash
pnpm exec wrangler versions deploy "$V2@100%" --name pr-a-rehearsal --message "rehearsal: v2" --yes
curl -s "https://$HOST/version.json"   # build rehearsal-v2
pnpm exec wrangler rollback "$V1" --name pr-a-rehearsal --message "rehearsal: back to v1" --yes
curl -s "https://$HOST/version.json"   # build rehearsal-v1
pnpm exec wrangler deployments list --name pr-a-rehearsal
```

Expected: each switch shows in `/version.json` within seconds, and the probe shows no non-200
line. Record the time from command to first new `build`. Delete the route again (Rollback 2a)
before Phase 4.

## Phase 4: the Custom Domain path

```bash
probe custom-domain   # second terminal
# 1. The Custom Domain cannot attach while the CNAME exists, so the record goes first.
#    The error window starts here.
cf -X DELETE "$CF/zones/$CLOUDFLARE_ZONE_ID/dns_records/$RECORD_ID"
# 2. Attach the hostname to the Worker. Cloudflare creates the DNS record and the certificate.
cf -X PUT "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" \
  --data "{\"hostname\":\"$HOST\",\"service\":\"pr-a-rehearsal\",\"zone_id\":\"$CLOUDFLARE_ZONE_ID\",\"environment\":\"production\"}"
```

Expected: the probe shows errors (a DNS failure, a TLS failure, or a Cloudflare 5xx) from step 1
until a valid certificate serves, then `code=200 runtime=workers`. Record the first error line,
the first good line and the curl errors in between. That span is the Custom Domain error window.

### Rollback 4a: Custom Domain off, back to Pages

```bash
DOMAIN_ID=$(cf "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains?hostname=$HOST" | node -pe "JSON.parse(require('fs').readFileSync(0)).result[0].id")
cf -X DELETE "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains/$DOMAIN_ID"
cf -X POST "$CF/zones/$CLOUDFLARE_ZONE_ID/dns_records" \
  --data "{\"type\":\"CNAME\",\"name\":\"$HOST\",\"content\":\"pr-a-rehearsal.pages.dev\",\"proxied\":true,\"comment\":\"decision 0160 Step 0.4 rehearsal; delete at teardown\"}"
cf "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/pr-a-rehearsal/domains/$HOST"   # status
```

Expected: an error window until the Pages custom domain is active again; it may need
re-validation. Record the window and whether the Pages domain re-validated on its own.

## Teardown

```bash
cf -X DELETE "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains/$DOMAIN_ID" || true
cf -X DELETE "$CF/zones/$CLOUDFLARE_ZONE_ID/workers/routes/$ROUTE_ID" || true
cf -X DELETE "$CF/zones/$CLOUDFLARE_ZONE_ID/dns_records/$RECORD_ID" || true
cf -X DELETE "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/pr-a-rehearsal/domains/$HOST" || true
pnpm exec wrangler delete pr-a-rehearsal --force
pnpm exec wrangler pages project delete pr-a-rehearsal --yes
git worktree remove /tmp/pr-a-rehearsal-main
```

Then revoke the rehearsal token. Verify: `dig +short $HOST` returns nothing, and
`https://jonathanlloyd.me/` still answers 200 with no `X-Site-Runtime`.

## Pre-cutover checklist (BLOCKER for Step 3.7)

Measured 2026-10-14 after gate G3: the Worker's Access application, "human-datastream - Cloudflare
Workers", carried an Access destination of type `worker`. Cloudflare documents that type as
"Production and preview deployments for one Worker" (API reference: "All requests routed to the
specified Worker, including its preview deployments, will be protected"); "Previews only" is type
`preview_worker`. Cut over with a `worker` destination and every visitor of `jonathanlloyd.me` meets
an Access login. The owner is recreating the application as Previews only (2026-10-14). Do not
start Step 3.7 until both hold:

1. **API: destination type `preview_worker`.** `CLOUDFLARE_ACCOUNT_ID=... CF_READ_TOKEN=... node
   scripts/check-worker-access-scope.mjs` passes. It asserts that at least one Access application
   destination names the `human-datastream` Worker (by its tag) and that EVERY such destination has
   `"type": "preview_worker"`. Any other type, `worker` above all, fails. Also confirm in the same
   API read that the application keeps both policies: "Cloudflare account members" (allow) and
   "site-ci-previews service auth" (Service Auth). It failed on 2026-10-14 against the `worker`
   destination.
2. **Production hostname, anonymously.** The moment the Worker answers the production hostname
   (the overlap route or the Custom Domain), run the same script with
   `--url https://jonathanlloyd.me/`: an anonymous GET must answer 200 with `X-Site-Runtime: workers`
   and no `X-Robots-Tag` (Cloudflare sends `X-Robots-Tag: noindex` on the Worker's preview
   hostnames; on production it would drop the site from search).
   A 302 to `spring-fire-4d98.cloudflareaccess.com`, a 401 or a 403 means roll back at once
   (Rollback 2a or 4a). Run the same pair in the Step 0.4 rehearsal against `$HOST` first.

## Merge coupling (input to Steps 3.7 and 8.6, not part of the rehearsal)

Merging PR A switches `deploy.yml` from `pages deploy` to `wrangler deploy`. From that merge until
the cutover, every merge to `main` deploys the Worker, which serves no hostname, and production
Pages receives nothing. A Pages deploy cannot run alongside it: the PR A build has no `functions/`,
so a Pages upload of `dist/client` would serve production without the middleware, the proxies and
the CSP. The post-deploy smoke check would also fail on that merge, because
`https://jonathanlloyd.me/version.json` would still report the Pages build.

The order that avoids both, for the owner to decide at Step 8.6:

1. Deploy the PR A branch build to the `human-datastream` Worker (the G2 path), verify it at its
   Version URL (Step 3.6), and run the rehearsed cutover so `jonathanlloyd.me` serves the Worker.
2. Merge PR A. `deploy.yml` redeploys the same code from `main`, and the smoke check sees its build.
3. Merge the atlas registry change at once (Step 7.1); the soak starts.

## Results: rehearsal of 2026-10-14 (owner-supervised)

Run by the PR A agent with the owner present, against the disposable names only. Token: the
user-owned `CF_REHEARSAL_API_TOKEN` (status active). Probe: one HTTPS request a second, resolving
the host through 1.1.1.1 each time (see "Deviations"). A second watch probed
`https://jonathanlloyd.me/` every 5 s for the whole run: 181 probes from 20:56:57 to 21:12:44 UTC,
every one 200 from Pages, no `X-Site-Runtime`.

| Phase                    | Mechanism                     | Error window | Non-200 lines | Marker before → after | Notes |
| ------------------------ | ----------------------------- | -----------: | ------------: | --------------------- | ----- |
| 2 overlap route          | Route on, DNS at Pages        | 0 s | 0 | pages → workers | Route on 21:04:17; first Worker answer 21:04:23 (6 s); two Pages answers at 21:04:32–33 (an edge picking the route up late); steady Worker from 21:04:35. Mixed serving 18 s, every answer 200. |
| 2 parity via the route   | `worker-parity.mjs`, baseline `pr-a-rehearsal.pages.dev` | — | — | — | 82/85; the 3 differences are `Cache-Control` on `/_astro/*` and `/assets/*`, set by the zone's transform rules on the zone hostname only. Production Pages sends the same values, so like-for-like with production it is 85/85. |
| 2a rollback              | Route off                     | 0 s | 0 | workers → pages | Route off 21:06:03; Pages from 21:06:05 (2 s); no flap. |
| 3 version switch         | `versions deploy` V2          | 0 s | 0 | v1 → v2 | 21:07:15; `/version.json` showed v2 within 10 s of the command start. |
| 3 rollback               | `wrangler rollback` V1        | 0 s | 0 | v2 → v1 | 21:07:25; v1 within 5 s. `deployments list` shows v1, v2, v1. |
| 4 custom domain          | CNAME off, Custom Domain on   | 0 s | 0 | pages → workers | CNAME deleted 21:08:04, Custom Domain attached 21:08:05 (Cloudflare created a proxied `AAAA 100::` record). Mixed Pages and Worker answers, all 200, until steady Worker from 21:09:37 (92 s). No TLS gap: the zone certificate covers the host. |
| 4a rollback              | Custom Domain off, CNAME on   | 37 s, plus one straggler | 32 (`522`) | workers → pages | Domain off 21:10:28, CNAME back 21:10:29. Removing the CNAME in Phase 4 had **deactivated** the Pages custom domain; until Pages re-activated it on its own (21:11:11) the host answered 522 from 21:10:30 to 21:11:06, then one more 522 at 21:11:34. |

Versions: V1 `52f66790-6f93-4367-ba06-48c789ad0dfa` (`rehearsal-v1`), V2
`6e66c710-9edc-411f-a56d-b93578827a9c` (`rehearsal-v2`).

**Custom Domain permission.** `PUT /accounts/:id/workers/domains` succeeded with the rehearsal
token, and so did the route, DNS, Pages and Worker writes. The token cannot read its own permission
groups (API 9109), so the exact group that the Custom Domain needed is not determined here; the owner
knows the token's groups. The token had no Workers KV read (see "Deviations").

**D7 recommendation: the overlap route.** A Workers Route on the proxied hostname, while its CNAME
still points at Pages, moved traffic to the Worker in about 6 s (18 s until every edge agreed) with
zero errors, and removing the route moved it back in 2 s with zero errors. So the cutover can run with
zero planned downtime, and the rollback during the soak is "delete the route". Do NOT use the Custom
Domain path as the first move: its cutover was error-free here, but its rollback cost 37 s of 522s,
because deleting the CNAME deactivates the Pages custom domain. If the Custom Domain is wanted
later (to retire the CNAME and then the Pages project, Step 8.9), attach it only after the soak,
when rolling back to Pages is no longer the plan.

**Deviations from the runbook text, and what they teach.**

- This Mac's resolver cached an NXDOMAIN for the new host (the first probes ran seconds after the
  record existed), so `curl` failed with exit 6 while 1.1.1.1 already answered. The probe and the
  parity run resolved through 1.1.1.1 instead (`curl --resolve`; a `dns.lookup` override for the
  one host). For the production cutover, probe through a public resolver too.
- The throwaway Worker was deployed from the generated config with `name` set to `pr-a-rehearsal`
  and `preview_urls: false`, not with `--name` alone: the PR A config has `preview_urls: true`, and
  no Access application covers a throwaway Worker, so its Version URLs would have been public.
- The Pages project was deployed from the root of a `main` worktree, so `functions/` shipped with it.
- `wrangler delete pr-a-rehearsal --force` deleted the Worker but then failed listing KV namespaces
  (the token has no KV read). The API confirmed the Worker gone (`10007`).

**Teardown, verified through the API with the read-only token.** DNS records identical to the
preflight snapshot (20 records); no Workers routes; no Workers custom domains; Pages projects
`human-datastream` only; Workers `api-catalog-content-type` and `human-datastream` only; the host does
not resolve at 1.1.1.1; `human-datastream` Pages domains unchanged; the `human-datastream` Worker
unchanged (workers.dev off, previews on, active version `05779aa8`); Access apps unchanged
(`preview_worker` on the Worker app). The rehearsal worktree, which held a copy of `.env.local`, is
removed. Revoke `CF_REHEARSAL_API_TOKEN`.

## Results (fill in)

| Phase            | Mechanism                   | Error window (s) | Non-200 lines | Marker before → after | Notes |
| ---------------- | --------------------------- | ---------------: | ------------: | --------------------- | ----- |
| 2 overlap route  | Route on, DNS at Pages      |                  |               | pages → workers       |       |
| 2a rollback      | Route off                   |                  |               | workers → pages       |       |
| 3 version switch | `versions deploy` V2        |                  |               | v1 → v2               |       |
| 3 rollback       | `wrangler rollback` V1      |                  |               | v2 → v1               |       |
| 4 custom domain  | CNAME off, Custom Domain on |                  |               | pages → workers       |       |
| 4a rollback      | Custom Domain off, CNAME on |                  |               | workers → pages       |       |

D7 outcome: the overlap route works (zero planned downtime) / does not (scheduled window of at
most 5 minutes, using the measured Phase 4 window).

## Production cutover: 2026-10-14 (Step 3.7, owner go "Switch over!")

Mechanism: the rehearsed overlap route (D7). `wrangler.jsonc` declared
`routes: [{pattern: "jonathanlloyd.me/*", zone_name: "jonathanlloyd.me"}]` at the cutover (removed after the PR A merge; see "Route ownership" below); the apex CNAME to
`human-datastream.pages.dev` is unchanged. Credentials: the owner's wrangler OAuth login.

| Time (UTC) | Event |
| ---------- | ----- |
| 22:27:33 | Pre-cutover: version `1b1265d9` of `fd6b0711` passed Access and parity 85/85 through `site-local-parity`; Access scope `preview_worker`; production 200 from Pages; no route. |
| 22:27:43 | Probe of `https://jonathanlloyd.me/` every 2 s (resolved through 1.1.1.1) started. |
| 22:28:08–22:28:14 | `wrangler deploy`: route `jonathanlloyd.me/*` published; version `b9bccaf6-89e3-46b6-8b3d-5c039721ee18`. |
| 22:28:16 | First Worker answer (2 s after the deploy ended); every answer from then on came from the Worker, none from Pages. |
| 22:29:36–22:29:41 | Same code redeployed with the build stamped `fd6b0711968baa1733e8a66233fbd8f4834a160e` (the first deploy's local build said `dev`); version `79268c5f-4271-411b-a8fd-3d9bae35c4ee`. |
| 22:39:18 | Probe stopped: 318 lines, 15 Pages answers before the cutover, 295 Worker answers after it, 0 HTTP errors, 4 connection timeouts (22:35:52–22:36:20) that coincide with this host's own network trouble (a `gh` TLS timeout to api.github.com) during the Docker suite; Cloudflare's edge recorded no visitor 5xx in those minutes. |

Post-cutover checks: `X-Site-Runtime: workers`; `/version.json` = `fd6b0711`, `runtime: workers`; no
`X-Robots-Tag`; anonymous 200, no Access redirect; `check-worker-access-scope.mjs --url
https://jonathanlloyd.me/` PASS; `/llms.txt`, `/llms-full.txt`, `/index.md`, `/feed.xml`,
`/feed.json` 200 through the CloudFront proxy; `/` negotiates Markdown; `/cf-insights.js` serves
the beacon; smoke check run 38648144924 green (18 passed, smoke bucket green); `audit-web.yml`
daily run 38648148453 green (B1 success, B6 measured 4).

Zone rules after the cutover: production compared with `human-datastream.pages.dev` went from 12/85
to 82/85 matching. The zone cache rule's browser TTL (`max-age=600`) and `Vary: accept-encoding` no
longer reach Worker responses, so `/sw.js` and `/version.json` now carry the code's
`max-age=0, no-store`, and revalidation answers 304. The three remaining differences are the zone's
transform rules on `/_astro/*` and `/assets/*`, unchanged. Edge 504s with user agent
`nginx-ssl early hints` (Cloudflare Early Hints subrequests, not visitor responses) appear before and
after the cutover at the same rate per request.

**Route ownership (owner decision 2026-10-14, option A).** The production route `jonathanlloyd.me/*`
(script `human-datastream`) lives in Cloudflare, not in `wrangler.jsonc`. Identify it by pattern and
script, never by id: the id changes whenever the route object is replaced. The PR A merge deploy
replaced it (`dfefa6b0…` to `0671ef3e…`), and so did the owner's dashboard edit that set fail open
(`0671ef3e…` to `536388ce…`, read back with `request_limit_fail_open: true`). It is set to fail open, so if the Workers Free daily
request limit runs out, requests bypass the Worker and reach the apex CNAME (the `human-datastream`
Pages project, which serves its last build) instead of a Cloudflare 1027 error. Why it left
wrangler: a deploy that declares routes replaces the Worker's route set with new route objects
(wrangler 4.149.0 `publishRoutes`, `cli.js:164031`: `PUT ${workerUrl}/routes`, commented "PUT will
delete previous routes on this script"; the route id changed from `dfefa6b0…` to `0671ef3e…` on the
first CI deploy), and the new object came back with `request_limit_fail_open: false`. A deploy that
declares no routes makes no route call (`triggersDeploy`, `cli.js:164803`; the only route write sits
behind `if (routesOnly.length > 0)`, `cli.js:164908`). The wrangler route schema has no fail-open key
(`cli.js:26344-26365`); the documented control is the dashboard toggle on the route
(https://developers.cloudflare.com/workers/platform/limits/).

**Rollback (production):** delete the route with `scripts/rollback-route.sh`, from any directory.
The dry run uses the read-only token that direnv loads from `.env.local`:
`CLOUDFLARE_API_TOKEN="$CLOUDFLARE_ACCOUNT_READALL" scripts/rollback-route.sh`. `--execute` uses the
wrangler login, not a token (owner decision, 2026-10-20). It reads the access token with the
repository's pinned wrangler, `pnpm exec wrangler auth token --json`, and ignores
`CLOUDFLARE_API_TOKEN`. The default `wrangler login` scopes include `workers_routes:write`, and
wrangler refreshes an expired login on its own. When it cannot, `--execute` stops before any API
call: run `pnpm exec wrangler login` from the repository, or check the login with
`pnpm exec wrangler whoami`. Do not run `wrangler auth token` by hand: it prints the token, and
wrangler writes it to its log file unless `WRANGLER_WRITE_LOGS=false`. The script never prints a
token. The zone defaults to `jonathanlloyd.me` (`4d14ef06a76b6f09918d27d3cca0a9c3`), and
`CLOUDFLARE_ZONE_ID` overrides it. The script resolves the id by pattern and script, and refuses
unless exactly one route matches. Without
a flag it is a dry run, GETs only: one API GET, plus a public `/version.json` GET when no route
matches. It prints the route and what the rollback does. `--execute` sends the one DELETE, reads the
routes back, and checks that Pages answers `/version.json` (no `runtime` key). `--self-test` proves
the script against stubbed `curl` and `pnpm`, with no network call. Or run the equivalent API calls
with any credential holding Workers Routes Edit on the zone; they put the token in curl's argv,
where `ps` shows it:

```bash
ROUTE_ID=$(curl -sS -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" |
  node -pe "JSON.parse(require('fs').readFileSync(0)).result.filter(r => r.pattern === 'jonathanlloyd.me/*' && r.script === 'human-datastream').map(r => r.id).join(' ')")
echo "route(s): $ROUTE_ID"   # expect exactly one id
curl -sS -X DELETE -H "Authorization: Bearer $TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes/$ROUTE_ID"
```

The CNAME still points at Pages, so the apex returns to Pages in about 2 s (rehearsal Rollback 2a:
0 errors). CI deploys no longer re-create the route, so the rollback lasts until someone re-creates it.
The route-deletion rollback ends at D7, because atlas decision 0162 item 3 deletes the route after
the Custom Domain attach. From the attach on, the Worker answers the apex without the route, so
deleting the route rolls nothing back. Undo the attach first, with Step 2 (d) of the D7 runbook:
atlas `decisions/evidence/0162-open-items/item-03-d7-runbook.md` (atlas PR #457).

**Re-creation (production):** create the route, then set fail open again, because a route created
through the API comes back fail-closed (the documented create body has only `pattern` and `script`):

```bash
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/workers/routes" \
  --data '{"pattern":"jonathanlloyd.me/*","script":"human-datastream"}'
```

Then, in the dashboard, set the route's request-limit failure mode to fail open. The dashboard edit
replaces the route object, so read it back by pattern, not by the id the POST returned:
`GET /zones/$ZONE_ID/workers/routes` must show one `jonathanlloyd.me/*` route for `human-datastream`
with `"request_limit_fail_open": true`.
