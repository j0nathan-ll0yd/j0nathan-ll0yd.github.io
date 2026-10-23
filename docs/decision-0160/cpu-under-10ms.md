# CPU of `GET /` on Workers Free: where it goes, and what can cut it

Investigation for atlas decision 0160, 2026-10-22. Code at website `7ab65c07` (#389). Production
version `b04e14e8`, soak window read from 2026-10-22T00:50:09Z to about 15:40Z. Nothing was deployed,
merged or changed. Production traffic from this work: one `HEAD` of `dashboard.json` at CloudFront,
and two proxied `GET`s (`/llms.txt`, `/feed.json`) that a local `wrangler dev` sent to CloudFront
while proving the lazy-import prototype.

## Conclusion

- **The tail is the first `GET /` on each isolate, not module start-up.** 60 of the 79 production
  `/` answers so far (76 percent) ran on an isolate that had not served `/` before. Those cost a
  median of 27 ms CPU (p90 53, max 66, minimum 18). The 19 that reused a warm isolate cost a median of
  4 ms. Section 1 gives the method.
- **Module evaluation is not charged to the request.** Requests on a brand-new isolate for
  `/version.json` or `/sw.js` cost 1 ms. Over 552 such requests the maximum was 4 ms. The Worker's
  start-up (767 KB of eager modules, about 27 ms of local CPU) shows up as cold-start wall time and
  against the separate 1 s start-up limit, never in `cpuTimeMs`. So lazy imports and module-scope
  trimming save 0 ms of request CPU.
- **A cold `/` pays for JIT-cold first execution.** Locally (workerd, DevTools profiler) the first
  request costs 16.6 ms of JS plus 1.3 ms of V8 compile time at the 80 KB artifact size; request 2
  costs 3.3 ms. The fragment check is 5.2 ms of the cold 16.6 (31 percent) and 0 ms warm, because
  the per-isolate memo hits. The shell cut is 2.0 ms cold and 0 warm. The remaining 7 ms is the
  first execution of the middleware, the proxy read, the response and the log line.
- **"Median under 10 ms" is not reachable on Free with this serving path.** Removing the fragment
  check entirely (measured, local) leaves a cold request at 11.6 ms local, about 18 ms on
  Cloudflare's CPU. With 76 percent of requests cold, the median stays near the cold cost. The best
  combination of the directions below lands near 15 to 18 ms.
- **"p99 under 10 ms" is reachable for a near-empty Worker, not for `/`.** The near-empty paths
  measured p99 3 ms over 552 requests. The record's "no Worker meets a 10 ms p99" (line 792) is too
  broad; it holds for `/` and for the proxies, not for a pass-through.
- **The limit is not enforced at these values.** 2,200 requests on this version, p99 36.9 ms, max
  66.9 ms, 0 errors, 0 `exceededCpu`. The documented "built-in flexibility" is the only thing keeping
  the page up, and it is undocumented in extent.

## 1. Production: cold or warm (question 1)

Method. Workers Logs events view (`POST /accounts/{account}/workers/observability/telemetry/query`),
version `b04e14e8` only, hourly windows (the view caps at 1,000 events). Each `ssr_render` log line
was joined to its invocation event on `$metadata.requestId` in memory; the fields kept were
`timestamp`, `colo`, `path`, `cpuTimeMs`, `wallTimeMs`, `outcome`, `status` and the log line's own
value-free numbers. No visitor field was read and no event was written to disk; only the aggregates
below were saved (`coldwarm-soak1.json`, `join-soak1.json`).

The cold marker. On production `Date.now()` advances only after I/O
(cloudflare-docs `workers/runtime-apis/performance.mdx`, pinned sha `d96b359b`). The log line's
`render_ms` is `total_ms - io_ms` (`src/lib/data-plane/ssr-response.ts:167,273`). After the read, the
only I/O on the composed path is the shell read through the ASSETS binding, which runs once per
isolate (`src/lib/composed/shell.ts:152-163`, `ssr-response.ts:158-159,191`). So `render_ms > 0` means
"this isolate had no shell yet": the first `/` on that isolate. `render_ms == 0` means a warm shell.

| `/` answers (200, joined)                  | n   | share | CPU median | p75 | p90 | p99 | max | min |
| ------------------------------------------ | --- | ----- | ---------- | --- | --- | --- | --- | --- |
| first `/` on the isolate (`render_ms > 0`) | 60  | 76 %  | 27         | 39  | 53  | 66  | 66  | 18  |
| warm isolate (`render_ms == 0`)            | 19  | 24 %  | 4          | 5   | 29  | 33  | 33  | 2   |
| all                                        | 79  |       | 25         | 36  | 46  | 66  | 66  | 2   |

Histogram, cold: 6 in [15, 20) ms, 26 in [20, 30), 13 in [30, 40), 8 in [40, 50), 7 in [50, 70).
Warm: 11 in [0, 5), 6 in [5, 10), 1 in [20, 30), 1 in [30, 40). The shell read itself took a median of
11 ms wall (p90 22, max 110). The read's I/O: `io_ms` median 508 ms, p99 1,489; `focus_ms` median 493;
`artifact_ms` median 508.

Gap to the previous Worker invocation of any path at the same colo (the isolate is per script, so any
request warms it, but one colo holds many machines):

| gap                                            | n   | CPU median | p90 | p99 |
| ---------------------------------------------- | --- | ---------- | --- | --- |
| first invocation at that colo since the deploy | 12  | 26         | 43  | 61  |
| under 10 s                                     | 32  | 18         | 40  | 55  |
| 10 s to 1 min                                  | 6   | 5          | 33  | 33  |
| 1 to 5 min                                     | 8   | 25         | 57  | 57  |
| 5 to 60 min                                    | 7   | 27         | 37  | 37  |
| over 60 min                                    | 14  | 38         | 58  | 66  |

A short gap does not mean a warm isolate. SJC, where this host's `/version.json` probe ran 552 times
in the window, still answered 12 of its 26 `/` requests from a cold shell (median 38 ms cold, 4 ms
warm). The other 19 colos were cold for 48 of 53 `/` requests. So "keep the isolate warm" cannot
reach the machines a visitor lands on.

The floor on this account. Paths that run the Worker but do almost nothing (`/version.json`,
`/sw.js`: route, ASSETS fetch, header policy): n = 552, median 0 ms, p75 1, p90 1, p99 3, max 4.
The two that were the first invocation at their colo after the deploy, a brand-new isolate, cost 1 ms.
Every other path (static pass-through, proxies, MCP, 404s): n = 1,297, median 1, p99 13, max 26; the
nine first-at-colo ones had a median of 7 and a maximum of 16.

Version totals (Workers GraphQL `workersInvocationsAdaptive`, `scriptVersion = b04e14e8`, `success`):
2,200 requests, cpuTime p50 0.97 ms, p75 1.43, p90 3.06, p99 36.9, p99.9 59.0, max 66.9, 0 errors.
Workers Logs outcomes: `ok` 2,143, `canceled` 21, no `exceededCpu`.

The record's claim (line 794, "Isolate start-up and JIT compilation drive the tail") is half right:
JIT-cold first execution drives it; module start-up does not reach the metric.

## 2. Start-up (question 2)

The build (`pnpm build`, Astro 7.2 with `@astrojs/cloudflare` 14.2.6, `no_bundle: true`) ships 31
modules, 1,362 KiB (gzip 336 KiB). `src/worker.ts:26` imports Astro's `handle` statically, so the
eager closure of `entry.mjs` is 11 modules and 767,390 bytes:

| module                                                             | bytes   | what                                                           |
| ------------------------------------------------------------------ | ------- | -------------------------------------------------------------- |
| `chunks/entrypoints_*.mjs`                                         | 265,951 | Astro server runtime; dynamically imports every route endpoint |
| `chunks/compat_*.mjs`                                              | 145,338 | Astro's Cloudflare compat layer                                |
| `chunks/server_*.mjs`                                              | 109,356 | Astro server internals                                         |
| `entry.mjs`                                                        | 89,679  | the Worker, composed read, data plane, middleware              |
| `chunks/assets_*.mjs`                                              | 89,209  | Astro assets/image service                                     |
| `chunks/proxy_*.mjs`                                               | 36,608  | the CloudFront proxy                                           |
| `chunks/_astro_assets_*.mjs`                                       | 23,960  | Astro assets                                                   |
| four small chunks (routes, constants, agent paths, llms artifacts) | 7,289   |                                                                |

The MCP server (`chunks/index_*.mjs`, 561,130 bytes, `@modelcontextprotocol/server`) and the route
endpoints are already dynamic imports of the Astro runtime; a cold `/` does not evaluate them.

`wrangler check startup` (6 runs): active CPU 21.5 to 29.2 ms, mean 27.1 ms; the coarse sampler
attributes 11 to 15 ms to the Astro `entrypoints` chunk, 4 to 11 ms to `assets`, 2.5 ms to `compat`
and 1.3 ms to `entry.mjs`. Profiles in `/tmp/website-cpu-prof/startup-baseline*.cpuprofile`.

Does a cold request pay for it? Not as request CPU (section 1: brand-new isolates answered
`/version.json` in 1 ms). It pays as cold-start wall time and against the 1 s start-up limit
(`workers/platform/limits.mdx:292-304` at the pinned sha).

Prototype (this branch, `src/worker.ts`): `handle` becomes a function that imports
`@astrojs/cloudflare/handler` on the first route request. Eager closure 129,033 bytes in 6 modules
(-83 percent); `wrangler check startup` active 19.7 to 22.4 ms, mean 20.9 (-6 ms, -23 percent);
bundle unchanged. Request CPU unchanged: cold `/` 12.6 ms JS + 4.2 ms compile across 3 runs against
16.6 + 1.3 before, inside run-to-run noise. Verified locally: `/`, `/mcp/server-card`, `/llms.txt`,
`/feed.json` and an MCP `initialize` all answer through the lazy handler; eslint, dprint, `astro check`
and the worker, routing, SSR response and concurrent-read unit suites pass (122 tests).

## 3. Per-request work on a warm isolate (question 3)

Method. `wrangler dev` (workerd, `nodejs_compat`) on the real build, a loopback fixture data plane
(`scripts/cpu-bench/fixture-plane.mjs`: `focus.json` plus an artifact with `composer.build` set to the
local build id and a stable `composedAt`, stamped `x-amz-cf-id`), `DATA_PLANE_BASE` and
`SSR_FAULT_INJECTION=1` on a loopback host (`src/lib/data-plane/config.ts`, `faults.ts`), and V8's
sampling profiler over the DevTools protocol at a 100 us interval
(`scripts/cpu-bench/profile.mjs`). Two artifact sizes: the committed 54,043-byte fixture and an
80,369-byte artifact composed from the `sixBooks` fixture variations
(`scripts/cpu-bench/compose-big.mjs`); the live artifact was 79,024 bytes at 15:30:51Z. Host: Apple
M-series. Inclusive figures of async functions overlap, because continuations nest under the
microtask root.

Warm, 80 KB, 100 requests on one isolate, per request:

| phase                                                                             | ms   |
| --------------------------------------------------------------------------------- | ---- |
| total active (JS + native)                                                        | 4.91 |
| V8 compile, unattributed `(program)`                                              | 0.43 |
| `readComposed`: probe + artifact fetch + `checkArtifact`                          | 3.03 |
| of which `readGatedConcurrently` (two `fetch` calls, timers, budget)              | 1.42 |
| of which `checkArtifact`: `JSON.parse` 80 KB, schema, memo compare, `checkRecord` | 0.74 |
| of which `TextDecoder.decode`                                                     | 0.62 |
| `checkFragments` (memo hit on the same text)                                      | 0.00 |
| `cutShell` (cached per isolate)                                                   | 0.00 |
| `fitsShell`                                                                       | 0.01 |
| `assemble` (string splice)                                                        | 0.00 |
| `withDashboardHeaders`                                                            | 0.01 |
| `logRender`                                                                       | 0.06 |
| middleware `onRequest` inclusive of routing and the response                      | 2.10 |

The production warm median (4 ms) matches. With a memo miss on every request (`composedAt` changed
per request) the warm cost is 6.5 ms, of which `checkFragments` 1.19 ms at 54 KB. In Node the
fragment check alone measures 0.77 ms warm (median of 300, 54 KB) and 5.4 to 6.4 ms in a fresh
process (`scripts/cpu-bench/bench.mts`).

Cold, the first request on a fresh isolate, mean of 5 isolates each:

| phase                                                                    | 54 KB   | 80 KB                |
| ------------------------------------------------------------------------ | ------- | -------------------- |
| total active (JS + native)                                               | 14.33   | 16.63 [14.68..20.78] |
| `(program)`: V8 compile                                                  | 2.09    | 1.33                 |
| garbage collector                                                        | 0.97    | 0.93                 |
| `checkFragments` (13 fragments, cold code)                               | 4.50    | 5.18 [4.86..5.62]    |
| `checkArtifact` inclusive                                                | 4.69    | 5.54                 |
| `cutShell`: HTMLRewriter over the 158,748-byte page + `cutMarked`        | 1.05    | 2.02 [0.77..3.10]    |
| `readGatedConcurrently`                                                  | 0.27    | 0.34                 |
| `TextDecoder.decode`                                                     | 0.25    | 0.46                 |
| `logRender`                                                              | 0.37    | 0.48                 |
| `fitsShell`, `assemble`, headers                                         | 0.09    | 0.03                 |
| everything else: first execution of middleware, routing, proxy, response | about 7 | about 7              |

Scaling to Cloudflare's CPU: production cold median 27 ms against local cold 18 ms (JS + compile)
gives about 1.5; production warm 4 ms against local 4.9 gives about 0.8. Cold estimates below use 1.5.

## 4. The JIT effect (question 4)

One isolate, 80 KB, each request profiled alone (`PER_REQUEST=12`):

| request    | 1     | 2    | 3    | 4    | 5    | 6 to 12    |
| ---------- | ----- | ---- | ---- | ---- | ---- | ---------- |
| active ms  | 14.72 | 3.31 | 3.30 | 2.90 | 2.92 | 2.1 to 2.9 |
| compile ms | 2.77  | 0    | 0    | 0    | 0    | 0 to 0.8   |

One request warms everything. The cold check cost is mostly fixed: 4.5 ms at 54 KB, 5.2 ms at 80 KB
(+49 percent bytes, +15 percent time), so shrinking the artifact buys little.

## 5. The floor (question 5)

- An empty-ish Worker on this account: median 0 to 1 ms, p99 3 ms, max 4 ms over 552 requests,
  including brand-new isolates. "p99 under 10 ms" is reachable for a pass-through.
- `/` without the fragment check at all (local variant, `memoizedFragments` and `fitsShell` short-
  circuited, 5 fresh isolates): cold 9.29 ms JS [7.35..11.13] + 2.29 compile = 11.6 ms, against 18.0
  with the check. Warm unchanged (5.45). About 18 ms on Cloudflare's CPU. That is the floor of the
  present serving path on a cold isolate.
- "Median under 10 ms" for `/` therefore needs either a cold share under about 40 percent (traffic
  is 1,440 requests a day over 23 colos and many machines; not controllable) or a cold `/` under 10 ms,
  which no direction below reaches.

## 6. Directions

| direction                                                     | request CPU saving, cold (local measured; Cloudflare estimate)                                                   | warm     | D3 / privacy / spec                                                                                                                                          | risk                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Lazy import of Astro's `handle` (prototype on this branch) | 0 ms; start-up active -6 ms (-23 %), eager bytes -83 %                                                           | 0        | none; `/` path untouched                                                                                                                                     | low; touches `src/worker.ts`, so merging restarts the soak                                                                                                                                                         |
| 2. Less work at module scope                                  | 0 ms (not charged)                                                                                               | 0        | none                                                                                                                                                         | none; not worth doing for CPU                                                                                                                                                                                      |
| 3. Cheaper fragment check, identical verdicts                 | bound -6.4 ms (-35 %); about -10 ms on Cloudflare, cold median 27 to about 17; a real rewrite gets perhaps half  | 0 (memo) | none if verdicts are identical; spec requirement "The Worker splices only allowlisted markup" unchanged                                                      | medium: equivalence must be proven by `tests/unit/composed-fragment.property.test.ts` (4,000 seeded parse5 cases), `tests/oracle/composer-parity.test.ts:485` and the record's 60 refusal probes (record line 905) |
| 4. Shell cut at build time                                    | `cutShell` 1 to 2 ms cold, minus about 0.5 ms to parse a precut 160 KB shell: net about 1 ms (1.5 on Cloudflare) | 0        | none (data-free page)                                                                                                                                        | low value; the cut must match the shipped `index.html` and the per-slot scope hashes                                                                                                                               |
| 5. Validate once per artifact digest across isolates          | the cold check, as 3's bound (-6.4 local, -10 Cloudflare), only when the flag exists                             | 0        | D3 analysis required: a verdict keyed by SHA-256 of the bytes, no content, in KV or the Cache API; a read per request adds wall time; the owner decides      | medium: cross-isolate state; a flag written by the Worker is unforgeable by a bucket writer                                                                                                                        |
| 6. Signature from the composer                                | as 5, every request; Ed25519 verify of 80 KB costs 0.13 ms (Node)                                                | 0        | trust model change (a compromised composer or key passes), data contract change: Surface Sweep over `atlas/surfaces.yaml` required; spec requirement changes | high; and it still leaves a cold `/` near 18 ms                                                                                                                                                                    |
| 7. Keep isolates warm                                         | 0: SJC with 552 probe requests still served 12 of 26 `/` cold                                                    | 0        | none                                                                                                                                                         | spends requests for nothing; one colo only                                                                                                                                                                         |
| 8. Workers Paid ($5 a month)                                  | removes the 10 ms limit (default 30 s); max observed 66.9 ms                                                     |          | none                                                                                                                                                         | owner's open decision 57; the measured tail is 450 times inside the Paid default                                                                                                                                   |

On direction 5 regardless of the decision: the existing per-isolate memo keys on the whole artifact
text and so keeps an 80 KB copy of gated content in isolate memory between requests
(`src/lib/composed/artifact.ts:257-270`). A SHA-256 digest (0.05 ms for 80 KB, WebCrypto) as the key
removes the copy at no visible cost. D3 hygiene, not a CPU change.

Outside the brief, for completeness: the only serving path that reaches a sub-10 ms cold median is one
where `/` does almost nothing per request (a pass-through costs 1 to 4 ms on this account). That means
the composer publishing the whole page and the Worker only gating and streaming bytes, which changes
the artifact contract the record set (the website owns the page around the fragments). Not evaluated
further here.

## 7. Recommendation

1. **Decide the plan, not the code.** The page runs at a cold median of 27 ms on a 10 ms limit and
   has never been cut off (0 `exceededCpu` in 2,200 requests). No direction on Free gets `/` under
   10 ms at the median; the best realistic set (3 plus 4) lands near 15 to 18 ms cold. Workers Paid
   removes the exposure for $5 a month. That is open decision 57 and the owner's call.
2. **After the soak ends (2026-10-29T00:50:09Z), merge the lazy import** if the owner wants the
   cold-start and start-up-limit benefit (start-up active -23 percent, eager bytes -83 percent). It
   changes no request CPU and no privacy path. Draft PR on this branch.
3. **Key the fragment memo on a digest, not the text** (D3 hygiene; 0.05 ms).
4. **If staying on Free and wanting the cold cost down:** direction 3, under the three equivalence
   proofs, targeting the 27 ms cold median to about 17. Do not expect 10.
5. **Do not pursue** warming (7), module-scope trimming (2) or the build-time shell (4, about 1 ms).

## Appendix: commands and files

- Worktree: `/Users/jlloyd/wt/paseo/2pmdmc5y/website-cpu`, branch `cpu-under-10ms-investigation`
  off `origin/main` at `7ab65c07`.
- Build: `pnpm build` (writes `dist/server/entry.mjs`, chunks and `wrangler.json`).
- Start-up: `pnpm exec wrangler check startup --outfile <file>.cpuprofile` from the repo root (it
  follows `.wrangler/deploy/config.json` to the built config). Eager closure: a walk over the
  `import ... from` statements of `dist/server/entry.mjs`.
- Fixture plane: `STABLE=1 node scripts/cpu-bench/fixture-plane.mjs 8791 <artifact.json> dev tests/fixtures/composed/focus.json`.
- Profiles: `PLANE=http://127.0.0.1:8791 node scripts/cpu-bench/profile.mjs <label> 100 100`
  (one cold request, then 100 warm); `PER_REQUEST=12 ... 0 100` for the progression. Summaries:
  `scripts/cpu-bench/phases.mjs <divisor> <profiles...>`, `scripts/cpu-bench/summarize.mjs`.
- Node cross-check: `pnpm exec tsx scripts/cpu-bench/bench.mts tests/fixtures/composed/dashboard.json 300`.
- Production aggregates: `coldwarm.mjs` and `join.mjs` (Workers Logs, events view, hourly windows,
  in memory) and the GraphQL query, copied beside this report in
  `atlas/.omc/research/cpu-under-10ms/`. The token came from the main checkout's `.env.local`, held in a
  0600 file inside a 0700 temporary directory, deleted afterwards.
- Variants measured and reverted: no fragment check (`artifact.ts` `memoizedFragments` and
  `shell.ts` `fitsShell` short-circuited); lazy `handle` (kept on this branch).
- Caveats: local CPU is an Apple M-series under an attached profiler; Cloudflare numbers are
  per-invocation totals rounded to whole milliseconds; n = 79 production `/` answers so far in the
  restarted soak; the cold marker counts a request as cold when the isolate had no shell, which is
  the first `/` on it, whatever other paths it served before.
