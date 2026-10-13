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
