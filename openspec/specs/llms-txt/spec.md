# LLM Content Discovery (llms.txt)

Surface: `llm-outputs` (atlas `surfaces.yaml`). That entry is the registry record for these
three artifacts; this spec is the behavior contract for the serving side of it.

## Purpose

Serve the llms.txt discovery index and its full-content dump so LLM agents can find and read
the site's canonical content. Content is composed upstream in mantle-LifegamesPortal (the
`llm-content` capability) and served here through thin CloudFront proxies; this spec owns the
SERVE, CONFORMANCE, FRESHNESS, and EXTERNAL-ANCHOR behaviors, not composition. This spec is
only as true as its covering tests.

## Context boundary — served artifacts

- `https://jonathanlloyd.me/llms.txt` — `text/plain; charset=utf-8` — proxy `functions/llms.txt.ts`
- `https://jonathanlloyd.me/llms-full.txt` — `text/markdown; charset=utf-8` — proxy `functions/llms-full.txt.ts`
- `https://jonathanlloyd.me/index.md` — byte-identical alias of llms-full.txt — proxy `functions/index.md.ts`
- `https://jonathanlloyd.me/` under an `Accept` that negotiates markdown (GET/HEAD only) — the same
  llms-full.txt representation, served by `functions/_middleware.ts` through the same factory; see
  "Markdown negotiation applies only to the homepage and honors Accept q-values" below.
- All three are built by one factory, `makeCloudfrontProxy` — `functions/_lib/proxy.ts`. That factory
  also builds /feed.xml and /feed.json, which are a DIFFERENT surface (`rss-feed`) and carry a
  different cache policy; see "Cache policy is per route" below.
- Upstream producer: mantle-LifegamesPortal `llm-content` capability, then CloudFront, then these proxies.

## Shape contract

A valid llms.txt is a grammar, not a data type. Its shape is defined by the rule catalog
`audits/specs/llms-txt/*.rule.json`, not by a TypeScript type. The typed contracts are:

- Served paths: `LLM_CONTENT_PATHS` and `DATASET_DISTRIBUTIONS` —
  `@j0nathan-ll0yd/portal-contract/constants`. `LLM_CONTENT_PATHS` covers `llmsFull` and
  `indexMarkdown`; `LLMS_TXT_PATH` derives the discovery path from the generated
  `LLM discovery index` distribution in `functions/_lib/llms-artifacts.ts`. No proxy owns a second
  hard-coded `/llms.txt` upstream path.
- Structural rules: `checkLlmsStructure(rawText)` — `@j0nathan-ll0yd/estate-contracts/llms-structure`.
  A network-free module carrying exactly ONE dependency, `zod`, pinned and asserted (atlas decision
  0103; see "the dependency" below). Atlas owns it and publishes it. BOTH SIDES OF THE SEAM CONSUME
  THE PACKAGE. The producer imports it in
  `mantle-LifegamesPortal/test/llm-content/llms-structure.contract.test.ts`; this repo imports it in
  `audits/checks/b2-llms.mjs:26`. Each declares `@j0nathan-ll0yd/estate-contracts` exact-pinned (the
  version literal lives in `package.json`, deliberately not restated here) and resolves it from its
  lockfile — atlas decisions 0079 item 4 wave 2b and 0080, this repo's PR #206, the producer's PR #239.
  Neither side vendors a copy any more. The reference sat at `scripts/audit/lib/llms-structure.mjs`
  here and at `mantle-LifegamesPortal/test/contracts/llms-structure.reference.mjs` there, each with
  a sha256 sidecar, until the 2026-08 migration deleted both.
  Agreement is enforced by atlas audit A10 (`audits/checks/conformance-fixtures.mjs`), which asserts
  every consumer's declared specifier is EXACT and IDENTICAL across consumers. A range specifier is a
  finding; so is a split across two exact versions. A10 records `repos: []` for this contract, so a
  silent re-vendor cannot pass unnoticed.
  `audits/__tests__/llms-structure.integrity.test.ts` checks the SHIPPED bytes against the sidecar shipped
  beside them — sha256 `149ea49a0c98448687dc6b081ed154ea2d3462d339526fdd4794144953483eae` — and
  asserts the spec version this repo was written against. `LLMS_STRUCTURE_SPEC_VERSION` is **3**.
- The dependency (atlas decision 0103, new in `0.7.0`): the tier's invariant is no longer "imports
  nothing" but "pinned, version-asserted dependencies" — the property `export-surface/extract.mjs`
  has had since decision 0030, where importing `typescript` stays deterministic because the version
  is pinned exactly and ASSERTED at conformance time. `VERIFIED_ZOD_VERSION` is that assertion for
  `zod`, currently **4.4.3**. Bytes plus the pinned Zod version determine behavior; bytes alone no
  longer do. The tier SPLITS by consumer: `llms-structure` may take the dependency because every
  consumer resolves it through a lockfile, while `openspec-covers` MUST stay zero-import because
  `ios-LifegamesPortal` vendors it as a FILE and runs it on bare node with no `node_modules`.
  Atlas audit A12 item 7 aligns any DECLARED `zod` specifier across governed repos to
  `VERIFIED_ZOD_VERSION`; it is an ALIGNMENT rule, not a mandate, so this repo — which declares no
  `zod` of its own and resolves `4.4.3` transitively — owes it nothing.
- Codec: `parseLlmsTxt(rawText)`, `encodeLlmsTxt(doc)`, and `decodeLlmsTxt(rawText)` over the typed
  `LlmsTxtDoc` model — same module, added in `0.4.0` and consumed here from `0.8.1` (atlas decision
  0099). `checkLlmsStructure` is unchanged by every codec release so far, so the RULE version stays
  **3** while the shipped bytes, the sidecar, and the package minor all moved.
  `decodeLlmsTxt(text).findings` is `checkLlmsStructure(text)`. `0.6.0` changed the codec's CANONICAL
  ENCODE FORM: a run of consecutive bullet-shaped prose lines — the profile's legal descriptive item,
  `- Framework: Astro` — now renders as one contiguous block rather than one paragraph each, while a
  non-bullet paragraph still stands alone and `parseLlmsTxt` stays the exact inverse regardless of
  blank runs. That is a byte-level change to what a producer emits, so it is covered here on its own
  terms rather than assumed: `audits/__tests__/b2-validate-llms-txt.property.test.ts` generates descriptive
  sections and asserts the catalog accepts them, that adjacent bullets are contiguous AND adjacent
  non-bullet prose is blank-line separated, and that the model round-trips.
  `0.7.0` (atlas decision 0103) then moved the codec's MODEL and encode-time guards onto Zod schemas
  — `LlmsTxtLinkSchema`, `LlmsTxtSectionSchema`, `LlmsTxtDocSchema`, `EncodableLlmsTxtDocSchema`, and
  the bidirectional `llmsTxtCodec` — while PRESERVING behavior: the Markdown grammar (the parse line
  walk and the encode serialisation) is unchanged, `encodeLlmsTxt` still throws a `TypeError` whose
  message begins `encodeLlmsTxt:`, and the schema's key order reproduces which failure the previous
  sequential `assertEncodable` calls threw on. So the canonical encode form is unchanged from `0.6.0`
  and the RULE version stays **3**; what moved is the shipped bytes and the sidecar.
  `0.8.0` (atlas decision 0110) is the first release that moved NEITHER rule tier's bytes:
  `llms-structure/reference.mjs` and `openspec-covers/reference.mjs` are byte-identical to `0.7.0`,
  so the sha256 cited above and `COVERS_SPEC_VERSION` **4** both stand unedited on that bump. It
  changed the `llms-assurance` tier only — it dropped `PROVENANCE_KINDS`, `validateProvenance`,
  `assertProvenance`, and the `./llms-assurance/provenance.schema.json` subpath for
  `validateServedVerification` / `assertServedVerification` (Atlas check A20 is that record's only
  writer and reader), and it lifted the GitHub Actions run block out of `validateSpokeEvidence`'s
  `$.source` into a shared `runSource` helper so a served verification's `$.verifiedBy` asks the
  same rule (atlas PR #268). Both were inert here: this repo imported none of the removed names,
  and at `0.8.0` `runSource` was a module-private `const` reachable through no `exports` subpath,
  so there was no builder to adopt yet.
  `0.9.0` (the consolidated 0110/0111/0113/0117 release, atlas PR #284) again moved neither rule
  tier's bytes — both sidecars stand unedited — and again changed only `llms-assurance` plus
  packaging. It exported the run-source builders `workflowPath(value)` and `buildRunSource(fields)`
  (decision 0111 phase 3a) — moot for this repo since atlas decision 0119 D1 retired the B2
  spoke-evidence envelope this repo used to build and validate. It collapsed the
  freshness config into the deep-frozen `LLM_FRESHNESS_CONFIG` export with byte-identical values
  (decision 0110 action 3): the `./llms-assurance/freshness-config.json` and
  `./llms-assurance/freshness-config.schema.json` subpaths are gone. That constant's
  `coherencePolicy` is now this repo's freshness/skew authority: `audits/lib/llms-coherence.ts`
  derives its thresholds from it via the published `durationToMilliseconds` (decision 0119 D2),
  and `audits/__tests__/llms-coherence.test.ts:76` tethers the evaluator configuration to it.
  It also dropped the `./openspec-covers/runner` and
  `./openspec-covers/fixture.json` subpaths (decision 0113 R4; this repo consumes only the tier's
  `reference.mjs` and its sidecar, which survive) and stopped shipping tier READMEs in the tarball
  (decision 0113 R2b).
  This repo's evaluation layer states its structural invariants over
  the parsed model instead of over local regexes: `audits/__tests__/b2-validate-llms-txt.property.test.ts`
  reads `title`, `summary`, `prose`, and `links` off `parseLlmsTxt` and builds two of its five
  mutations with `encodeLlmsTxt`, and `audits/__tests__/llms-differential.test.ts` classifies the
  missing-H1 class by `title === null`. Both consumer-side assumptions — decode-equals-check, and
  parse's early return agreeing with the checker's — are verified against the resolved bytes by a
  zero-divergence differential over the full v3 pool rather than taken from the package README.
  The `linkListItems` invariant in that suite is deliberately STRONGER than the rule (it rejects any
  bullet surviving in prose, including the legal descriptive item) and is sound only because its
  generator emits nothing but link items; the legal descriptive shape is covered by the descriptive
  section suite above and by the v2 relaxation class in the differential suite.
- Checker: `validateLlmsTxt(rawText)` — `audits/checks/b2-llms.mjs:49`. A catalog wrapper
  that stamps severity onto the shared reference's findings.
- Finding: `{ id, severity: 'fail' | 'warn', message }` — currently structural. The severity enum is
  declared in `audits/specs/rule.schema.json:126` and stamped by `emit()`, never chosen by the
  validator. Proposed follow-up: a named `LlmsFinding` typedef so the output shape is specified,
  not implied.

## Requirements

### Requirement: Discovery index and full dump are served at the contract paths

The system SHALL serve /llms.txt, /llms-full.txt, and /index.md, each with its declared
content-type. /llms-full.txt and /index.md SHALL resolve from `LLM_CONTENT_PATHS`; /llms.txt SHALL
resolve from the portal contract's generated discovery distribution.
Verified by `tests/unit/cloudfront-proxy.test.ts:271` (all five proxy routes: upstream URL, status,
content-type, including the registry-derived discovery path).

#### Scenario: Advertised path resolves

- **GIVEN** an agent fetches a path advertised in the llms.txt index
- **WHEN** the proxy handles the request
- **THEN** the system SHALL return the upstream content with the declared content-type

### Requirement: Canonical llms responses always pass through the privacy gate

The portfolio SHALL NOT permit a browser, a generic downstream CDN, or the Cloudflare edge cache
to retain a canonical llms response and answer a later request without executing the Pages
Function's focus-mode privacy transition check. Every public success, stale fallback, suppression,
and error response SHALL therefore carry `Cache-Control: no-store`, `CDN-Cache-Control: no-store`,
and `Cloudflare-CDN-Cache-Control: no-store`. The CloudFront fetch cache (60 seconds) and the
explicit Cache API last-known-good entry (3 hours) are separate origin-side caches behind the
privacy check; the stored LKG representation SHALL NOT retain the public CDN no-store headers.

Verified by `tests/unit/cloudfront-proxy.test.ts:66` (proxy response policy: three-layer no-store
headers, private LKG separation, and a warm-visible → suppressed → visible privacy transition) and
`audits/__tests__/cloudflare-llms-cache-rules.test.ts:36` (external rule audit: applicability,
GET-only transport, fail-closed permission handling, evidence output, and credential redaction).

Cloudflare's response-header contract gives `Cloudflare-CDN-Cache-Control` precedence over
`CDN-Cache-Control` and `Cache-Control`, and treats `no-store` as BYPASS. An account-level Edge
Cache TTL or Cache Response Rule can override origin-set headers, so deployment also depends on
the canonical paths having no such override and on purging representations retained by the old
rule. The weekly coherence audit makes that external state visible by requiring the returned
browser/CDN policy and `CF-Cache-Status: BYPASS|DYNAMIC`.

The non-deploying weekly audit also SHALL inspect active account- and zone-level Cache Rules,
Cache Response Rules, and Page Rules through read-only Cloudflare API requests for exactly the
three canonical URLs. An applicable origin-ignoring Edge/Browser TTL, cache-control override, or
custom key that prevents the exact three-URL purge SHALL fail. Missing permissions, incomplete API
responses, executed rulesets that cannot be expanded, and unsupported applicability expressions
SHALL be indeterminate and nonzero rather than clean. The audit SHALL never call a mutation, Trace,
or purge endpoint and SHALL emit an uploadable credential-free evidence file.

#### Scenario: A focus transition cannot be bypassed by a public cache hit

- **GIVEN** a visible request has populated the origin fetch cache and internal LKG
- **WHEN** the focus state changes to a hiding mode before the next canonical request
- **THEN** the next request SHALL execute the privacy probe and return suppression, not retained content

### Requirement: Raw and canonical llms artifacts stay coherent

For all three artifacts, the raw CloudFront and canonical portfolio responses SHALL return HTTP
200, the side-specific declared content-type, and a parseable composition timestamp. A canonical
composition timestamp SHALL differ from its raw origin by no more than 10 minutes. The full/index
aliases on each side SHALL also differ by no more than 10 minutes. When two compared full-content
responses advertise the same composition timestamp, their bytes SHALL be identical. Different
fresh timestamps within that convergence window represent adjacent valid generations and SHALL
NOT, by byte difference alone, be reported as corruption.

Verified by `audits/__tests__/llms-coherence.test.ts:53` (coherence evaluator).
The pure snapshots cover status, content-type, both timestamp syntaxes, bounded convergence,
same-generation byte equality, and cache policy; `audits/checks/b2-llms.mjs` (the one merged weekly
llms check, atlas decision 0119 D2) runs the same evaluator as its coherence arm beside the
structural catalog arm.

Weekly B2 SHALL derive a tri-state status from the run and expose it as the `issue_outcome`
GITHUB_OUTPUT before returning its audit exit code (`audits/lib/llms-issue-outcome.ts`; the Atlas
spoke-evidence v1 envelope this repo used to write and upload was retired by atlas decision 0119
D1 — lane liveness belongs to decision 0116's per-tier tiles now). The fold: any definitive
failure wins, otherwise any observation gap wins, otherwise `passed`. Definitive failures are
fail-severity catalog findings and coherence findings whose participant responses were all
observed; confirmed suppression, an indeterminate suppression probe, incomplete response
transport, and uncaught audit failures are observation gaps. A coherence finding whose every
participant response is transport-incomplete SHALL NOT count as definitive — it restates the
transport gap. Thus a true finding plus incomplete transport remains `failed`, while clean
suppression is `unknown`; a warn-severity catalog finding alone SHALL leave the status `passed`
and the exit 0. Confirmed suppression SHALL stop before any artifact fetch while still producing
the unknown outcome. Status classification does not replace the audit's exit/finding semantics.
The CLI SHALL write the managed-issue outcome derived only from that status: `passed` →
`success`, `failed` → `failure`, and `unknown` → `indeterminate`. The reconciler SHALL consume
that explicit output, not the process step outcome; missing output SHALL remain indeterminate.
Therefore suppressed, incomplete, and uncaught-unknown runs neither open nor close the managed
issue, a definitive finding opens or reopens it, and only an all-passed run can close it.

Verified by `audits/__tests__/b2-llms.test.ts:110` (orchestration and issue-outcome channel).
Those tests cover the suppression short-circuit, transport observation, the tri-state fold, the
output mapping, uncaught failure, and the issue lifecycle. `audits/__tests__/audit-web-workflow.test.ts`
asserts no workflow-level suppression skip, report-only exit preservation, the reconciler
consuming `steps.llms.outputs.issue_outcome`, and that no evidence envelope step survives.

#### Scenario: Same-generation bytes diverge

- **GIVEN** two compared full-content responses advertise the same composition timestamp
- **WHEN** the coherence evaluator compares the six responses
- **THEN** differing bytes SHALL be reported as a coherence failure with per-side evidence

#### Scenario: Adjacent generations converge normally

- **GIVEN** independently cached keys or POPs expose different fresh compositions no more than 10 minutes apart
- **WHEN** their bytes differ during the convergence window
- **THEN** the evaluator SHALL NOT report byte corruption, but SHALL continue to compare any pair that advertises the same composition timestamp

#### Scenario: Compositions exceed the convergence window

- **GIVEN** an origin/site pair or same-side full/index pair has composition timestamps more than 10 minutes apart
- **WHEN** the coherence evaluator compares them
- **THEN** it SHALL report excessive composition skew without needing to infer byte corruption

### Requirement: Cache policy is per route, and the feed routes stay edge-cached

`makeCloudfrontProxy` builds FIVE routes, not three. The no-store policy the requirement above
mandates SHALL be carried by the llm-outputs trio ONLY. /feed.xml and /feed.json are the `rss-feed`
surface, and their success and stale responses SHALL carry `public, max-age=0, s-maxage=60` with NO
`CDN-Cache-Control` and NO `Cloudflare-CDN-Cache-Control`. The policy SHALL therefore be a per-route
`CachePolicy` on `CloudfrontProxyConfig`, never a constant shared by every route.

Responses no route may ever have cached -- suppression, focus-error, terminal-error and
method-not-allowed -- remain unconditionally no-store regardless of the route's artifact policy.

Verified by `tests/unit/cloudfront-proxy.test.ts:296` (per route, both paths, both directions: the
trio no-store, the feeds edge-cached, and the last-known-good copy).

This requirement exists because a shared constant is exactly how the two surfaces got conflated
once already: a factory-level change intended for the canonical llms responses silently retagged
both feeds as no-store, and the factory-level tests could not see it because they exercise one
synthetic path. The feed assertions are per route for that reason.

#### Scenario: A feed route keeps its edge cache

- **GIVEN** a client fetches /feed.xml or /feed.json
- **WHEN** the proxy returns upstream content or a stale last-known-good copy
- **THEN** the response SHALL carry `public, max-age=0, s-maxage=60` and no CDN cache header

#### Scenario: A stale feed response does not inherit the cached entry's headers

- **GIVEN** a last-known-good entry whose stored headers say `no-store`
- **WHEN** the feed route serves it as a stale fallback
- **THEN** the response SHALL carry the route's own edge-cached policy, not the stored headers

### Requirement: Markdown negotiation applies only to the homepage and honors Accept q-values

Markdown content negotiation SHALL apply only to `GET`/`HEAD` requests for `/`, decided in
`functions/_middleware.ts`. The explicit artifact paths (/llms.txt, /llms-full.txt, /index.md),
pages, API routes, and feeds SHALL NOT negotiate: each keeps its own bytes and content type for
every `Accept` value. This requirement replaced a middleware that negotiated on every path and
method via an `Accept` substring test, which served llms-full bytes for an explicit GET /llms.txt
and treated `text/markdown;q=0` as a request.

A homepage request SHALL negotiate markdown only when `Accept` names `text/markdown` explicitly
with q greater than zero AND that q is strictly greater than the effective q of `text/html`
(matched with standard precedence: exact `text/html`, then `text/*`, then the full wildcard).
A wildcard SHALL never select markdown. `text/markdown;q=0` SHALL serve HTML. A bare
`Accept: text/markdown` SHALL serve the full markdown document — the agent-readiness case.
TIE RULE: when `text/markdown` and `text/html` carry EQUAL q, the homepage SHALL serve HTML.
Markdown requires a strictly higher preference, for the same reason a wildcard never selects it:
the markdown representation is opt-in and needs an unambiguous signal, and HTML is the canonical
homepage representation.

The negotiated representation IS /llms-full.txt's. The middleware SHALL serve it through the same
`makeCloudfrontProxy` machinery as the explicit route — privacy gate, bounded retry,
last-known-good under the shared cache key, and the llm-outputs no-store policy — with no
independent fetch path, and SHALL finalize it through the same response-header pipeline as every
other response (security headers, Content-Usage, discovery Link header). Every homepage
representation SHALL carry `Vary: Accept`, merged into any existing `Vary`. A negotiated HEAD
response SHALL carry no body.

Verified by `tests/unit/middleware-negotiation.test.ts:53` (decision table, scope, response classes),
and verified by `tests/unit/cloudfront-proxy.test.ts:392` (explicit routes ignore Accept).

#### Scenario: An agent asks the homepage for markdown

- **GIVEN** a GET / request with `Accept: text/markdown`
- **WHEN** the middleware negotiates
- **THEN** it SHALL serve the /llms-full.txt representation through the shared proxy machinery,
  with the three no-store cache headers, the pipeline's security headers, and `Vary: Accept`

#### Scenario: An explicit artifact path never negotiates

- **GIVEN** a GET /llms.txt request with `Accept: text/markdown`
- **WHEN** the middleware handles it
- **THEN** it SHALL pass the request through to the route, preserving the discovery document's
  bytes and content type

#### Scenario: Markdown is rejected or not named

- **GIVEN** a GET / request whose `Accept` is `text/markdown;q=0`, a bare wildcard, or a
  browser-typical value that does not name `text/markdown`
- **WHEN** the middleware decides the representation
- **THEN** it SHALL serve HTML

### Requirement: Served llms.txt conforms to the Lifegames llms.txt profile

The served llms.txt SHALL begin with an H1, SHALL follow it with a summary blockquote, and SHALL
contain exactly one H1. Every H2 section list item that carries an http(s) URL SHALL wrap it as a
well-formed `[name](url)` markdown link — nonempty label, nonempty destination — and every H2
heading SHALL have content under it.
Verified by `audits/__tests__/spec-cases.test.ts:123` (the five convention rules, derived cases) and
`audits/__tests__/b2-validate-llms-txt.property.test.ts` (the five structural invariants as
properties, tethered by its three `covers:` comments at `:169`, `:203`, and `:265`).

SPEC VERSION 3, dated 2026-08-13. v1 required every list item to be a markdown link and every H2
section to hold a list. The producer contract test found the live index legitimately mixing file
lists with descriptive sections, so v2 permits a list item with no URL and an H2 section carrying
prose. v3 tightened the link test in one place: a link needs a nonempty label AND a nonempty
destination, so `- [](https://x.com)` and `- [name]()` now fire where v2 stripped them as if they
were real links. v2 was also stricter than v1 in exactly one place: an unlinked URL in a link
item's notes tail fires, where v1's permissive tail swallowed it.

The v1→v2 and v2→v3 deltas are pinned as evidence, not described in prose:
`audits/__tests__/llms-differential.test.ts:113` differences the live reference against frozen copies of
each earlier version over a fixed seed, run count, and input pool, and asserts the exact
divergence classes and counts.

PROFILE, NOT STRICT CONFORMANCE (atlas decision 0040). The two v2 relaxations diverge from the
llmstxt.org clause the rule files cite. What this repo checks is therefore the LIFEGAMES llms.txt
PROFILE — llmstxt.org-derived, with two documented relaxations — and not byte-for-byte conformance
to the relaxed clauses. A green structural run means "conforms to the profile"; it does not mean
"conforms strictly to llmstxt.org". The relaxations are named in `llms-txt-h2-no-file-list` and
`llms-txt-non-link-list-item`, in each rule's `policy_note`, with the provenance of the original
clause left intact beside them.

#### Scenario: A well-formed index passes every structural rule

- **GIVEN** a served llms.txt with an H1, a summary blockquote, and linked H2 items
- **WHEN** validateLlmsTxt runs
- **THEN** it SHALL emit no fail-severity structural finding

#### Scenario: A descriptive section is not a defect

- **GIVEN** an H2 section whose items describe the stack rather than link to files
- **WHEN** validateLlmsTxt runs
- **THEN** it SHALL emit no finding for those items

#### Scenario: An unlinked URL is a defect

- **GIVEN** an H2 section list item carrying a bare http(s) URL outside a markdown link
- **WHEN** validateLlmsTxt runs
- **THEN** it SHALL emit `llms-txt-non-link-list-item`

#### Scenario: A link with an empty part is a defect

- **GIVEN** an H2 section list item whose markdown link has an empty label (`- [](url)`) or an
  empty destination (`- [name]()`)
- **WHEN** validateLlmsTxt runs
- **THEN** it SHALL emit `llms-txt-non-link-list-item`

### Requirement: Full-content artifacts stay fresh

Every raw and canonical representation of llms.txt, llms-full.txt, and index.md SHALL carry a
parseable composition timestamp no more than 4 hours old. The discovery index uses its
`<!-- composed-at: ... -->` marker; the full artifacts use `**Generated:** ...`. The threshold
authority is the packaged estate contract: `audits/lib/llms-coherence.ts` SHALL derive
`maxCompositionAgeMs` and `maxCompositionSkewMs` from
`LLM_FRESHNESS_CONFIG.layers.portfolioServing.coherencePolicy` via `durationToMilliseconds`
(atlas decision 0119 D2 — the retired stale rules' `params.maxAgeHours` restatements and the
local `LLMS_MAX_COMPOSITION_AGE_MS` constant are gone; `maxFutureSkew` stays a local 5-minute
constant until it joins the contract at estate-contracts `0.10.0`). The merged weekly check's
coherence arm applies the thresholds to all six live responses; its presence arm keeps the
site-side existence/non-emptiness of llms-full.txt and index.md definitive through the
operational catalog rules `llms-full-txt` and `index-md`.

Verified by `audits/__tests__/llms-coherence.test.ts:75`, which injects a fixed clock and synthetic response
snapshots to exercise the exact age boundary logic without network and asserts the evaluator
configuration equals the contract's `coherencePolicy`, and by `audits/__tests__/b2-llms.test.ts:206`
(the presence arm). The old `spec-cases.test.ts` covers claim was
removed: that harness only proved operational rules had no cases and never exercised freshness.

#### Scenario: A composition exceeds the freshness window

- **GIVEN** an otherwise valid response composed more than 4 hours before a fixed evaluation time
- **WHEN** the pure coherence evaluator runs
- **THEN** it SHALL emit a stale finding for that response

### Requirement: Conformance claims are anchored to the external convention

Every conformance rule SHALL carry `spec.verified_against_source` true against a SHA-pinned source,
and each normative quote SHALL still occur in that source.
Verified by `audits/__tests__/spec-cases.test.ts:124` (blocking).

The anchor is a PROVENANCE claim, not a conformance claim. What these two gates prove is that the
quoted clause is really what the pinned source says — nothing more. Where a rule departs from the
clause it quotes, that departure is the LIFEGAMES llms.txt PROFILE (atlas decision 0040), stated in
the rule's `policy_note` beside the intact citation. Two rules are in that position today,
`llms-txt-h2-no-file-list` and `llms-txt-non-link-list-item`; both are `rule_class: convention`, and
neither asserts strict structural conformance to the llmstxt.org clause it cites. Every other rule
in the catalog checks its clause as quoted.

#### Scenario: A clause-citing rule cannot load unverified

- **GIVEN** the five llms-txt convention rules each cite an llmstxt.org Format-section clause
- **WHEN** the spec-cases harness loads the llms-txt catalog through `rules('llms-txt')`
- **THEN** the rule schema SHALL require `spec.verified_against_source` true with a `verified_at`
  date and an immutable or commit-pinned `verification_url` on every one of them, and SHALL reject
  the load otherwise

## Validation matrix

| Requirement              | Unit                                       | Integration                          | Audit (prod)                   | Provenance               |
| ------------------------ | ------------------------------------------ | ------------------------------------ | ------------------------------ | ------------------------ |
| Served at contract paths | `cloudfront-proxy.test.ts` (fetch stubbed) | raw/canonical coherence evaluator    | weekly B2 llms (coherence arm) | portal contract          |
| Privacy/cache transition | `cloudfront-proxy.test.ts`                 | response headers + `CF-Cache-Status` | weekly B2 llms (coherence arm) | Cloudflare docs          |
| Homepage negotiation     | `middleware-negotiation.test.ts`           | — (middleware unit-only)             | —                              | RFC 9110 Accept          |
| Origin/site coherence    | pure snapshots + issue-outcome fold        | six live responses                   | weekly B2 llms issue_outcome   | contract coherence       |
| Structural profile       | spec-cases + property test                 | — (external consumer)                | weekly B2 llms (structure arm) | —                        |
| Shared-reference bytes   | `llms-structure.integrity.test.ts`         | producer consumes the same exact pin | —                              | lockfile + sidecar       |
| Freshness                | `llms-coherence.test.ts` (fixed clock)     | six live responses                   | weekly B2 llms (coherence arm) | contract coherencePolicy |
| External anchor          | spec-verification                          | —                                    | weekly drift                   | pinned source            |

## Gaps

- The upstream producer is out of this repo; nothing here asserts what it composes.
- Operational rule files still have no catalog `cases` by schema. Freshness behavior is instead
  exercised through the pure coherence evaluator, whose configuration is tethered to the packaged
  contract's `coherencePolicy` (the stale rules that restated the 4-hour parameter were retired by
  atlas decision 0119 D2); the surviving operational presence rules are exercised through the merged
  check's presence arm in `audits/__tests__/b2-llms.test.ts`.
- The Cloudflare account's cache rules are external to this repository. A rule that ignores origin
  cache-control must be removed for the three canonical paths, and old retained objects must be
  purged; the audit detects but cannot mutate that configuration.
- This repo no longer emits Atlas spoke evidence: atlas decision 0119 D1 retired the B2 envelope,
  its upload, and the emit-time `assertSpokeEvidence` instance (the wire-token drift class that
  assertion caught — the producer once stamped the retired `web-Lifegames-Portal` alias in
  `source.repository` for two days and every B2 artifact failed ingest — retires with the wire).
  A weekly-lane failure stays visible where it always was: the check reds its step, the managed
  issue opens on the `llms` bucket, and the lane's own liveness tile (atlas decision 0116) catches
  a dark lane. The package's `./llms-assurance/spoke-evidence.schema.json` subpath still exists;
  nothing here consumes it.

## Enforcement note

This repo has no `mantle check openspec` tooling. The `covers:` tethers in the covering test files
are instead enforced by the openspec-covers contract, consumed from
`@j0nathan-ll0yd/estate-contracts/openspec-covers` at `COVERS_SPEC_VERSION` 4 (atlas decisions 0079
item 4 wave 2b, 0080). It was vendored at `scripts/vendor/openspec-covers.mjs` until that migration;
the copy is gone and must not come back. `scripts/openspec-covers.mjs` wraps the package and runs
blocking via `pnpm run check:covers` and the `covers-conformance` job in
`.github/workflows/static-checks.yml`, on every pull request and every push to main.
