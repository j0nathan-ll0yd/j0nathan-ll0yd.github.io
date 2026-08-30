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

- `https://jonathanlloyd.me/llms.txt` — `text/plain; charset=utf-8` — proxy `functions/llms.txt.ts:11`
- `https://jonathanlloyd.me/llms-full.txt` — `text/markdown; charset=utf-8` — proxy `functions/llms-full.txt.ts:9`
- `https://jonathanlloyd.me/index.md` — byte-identical alias of llms-full.txt — proxy `functions/index.md.ts:9`
- All three are built by one factory, `makeCloudfrontProxy` — `functions/_lib/proxy.ts:26`
- Upstream producer: mantle-LifegamesPortal `llm-content` capability, then CloudFront, then these proxies.

## Shape contract

A valid llms.txt is a grammar, not a data type. Its shape is defined by the rule catalog
`scripts/audit/specs/llms-txt/*.rule.json`, not by a TypeScript type. The typed contracts are:

- Served paths: `LLM_CONTENT_PATHS` — `@j0nathan-ll0yd/portal-contract/constants`. It covers
  `llmsFull`, `llmsSmall`, and `indexMarkdown`. `/llms.txt` has no constant; its route hardcodes
  the path (`functions/llms.txt.ts:11`). See Gaps.
- Structural rules: `checkLlmsStructure(rawText)` — `@j0nathan-ll0yd/estate-contracts/llms-structure`.
  A pure, framework-free module; atlas owns it and publishes it. BOTH SIDES OF THE SEAM CONSUME THE
  PACKAGE. The producer imports it in
  `mantle-LifegamesPortal/test/llm-content/llms-structure.contract.test.ts`; this repo imports it in
  `scripts/audit/validate-llms-txt.mjs:14`. Each declares `@j0nathan-ll0yd/estate-contracts`
  exact-pinned at `0.2.0` (here `package.json:56`) and resolves it from its lockfile — atlas
  decisions 0079 item 4 wave 2b and 0080, this repo's PR #206, the producer's PR #239.
  Neither side vendors a copy any more. The reference sat at `scripts/audit/lib/llms-structure.mjs`
  here and at `mantle-LifegamesPortal/test/contracts/llms-structure.reference.mjs` there, each with
  a sha256 sidecar, until the 2026-08 migration deleted both.
  Agreement is enforced by atlas audit A10 (`audits/checks/conformance-fixtures.mjs`), which asserts
  every consumer's declared specifier is EXACT and IDENTICAL across consumers. A range specifier is a
  finding; so is a split across two exact versions. A10 records `repos: []` for this contract, so a
  silent re-vendor cannot pass unnoticed.
  `tests/audit/llms-structure.integrity.test.ts` checks the SHIPPED bytes against the sidecar shipped
  beside them — sha256 `50ac4620b1981486f92e285f497e6e8a90fbc8c8bb2bd2272698550f4d6662fc` — and
  asserts the spec version this repo was written against. `LLMS_STRUCTURE_SPEC_VERSION` is **3**.
- Checker: `validateLlmsTxt(rawText)` — `scripts/audit/validate-llms-txt.mjs:44`. A catalog wrapper
  that stamps severity onto the shared reference's findings.
- Finding: `{ id, severity: 'fail' | 'warn', message }` — currently structural. The severity enum is
  declared in `scripts/audit/specs/rule.schema.json:126` and stamped by `emit()`, never chosen by the
  validator. Proposed follow-up: a named `LlmsFinding` typedef so the output shape is specified,
  not implied.

## Requirements

### Requirement: Discovery index and full dump are served at the contract paths

The system SHALL serve /llms.txt, /llms-full.txt, and /index.md, each with its declared
content-type. /llms-full.txt and /index.md SHALL resolve from `LLM_CONTENT_PATHS`; /llms.txt has
no such constant.
Verified by `tests/unit/cloudfront-proxy.test.ts:252` (all five proxy routes: upstream URL, status,
content-type).

#### Scenario: Advertised path resolves

- **GIVEN** an agent fetches a path advertised in the llms.txt index
- **WHEN** the proxy handles the request
- **THEN** the system SHALL return the upstream content with the declared content-type

### Requirement: Served llms.txt conforms to the Lifegames llms.txt profile

The served llms.txt SHALL begin with an H1, SHALL follow it with a summary blockquote, and SHALL
contain exactly one H1. Every H2 section list item that carries an http(s) URL SHALL wrap it as a
well-formed `[name](url)` markdown link — nonempty label, nonempty destination — and every H2
heading SHALL have content under it.
Verified by `tests/audit/spec-cases.test.ts:122` (the five convention rules, derived cases) and
`tests/audit/validate-llms-txt.property.test.ts:131` (the five structural invariants as properties,
tethered by the `covers:` comment at `:131`).

SPEC VERSION 3, dated 2026-08-13. v1 required every list item to be a markdown link and every H2
section to hold a list. The producer contract test found the live index legitimately mixing file
lists with descriptive sections, so v2 permits a list item with no URL and an H2 section carrying
prose. v3 tightened the link test in one place: a link needs a nonempty label AND a nonempty
destination, so `- [](https://x.com)` and `- [name]()` now fire where v2 stripped them as if they
were real links. v2 was also stricter than v1 in exactly one place: an unlinked URL in a link
item's notes tail fires, where v1's permissive tail swallowed it.

The v1→v2 and v2→v3 deltas are pinned as evidence, not described in prose:
`tests/audit/llms-differential.test.ts:113` differences the live reference against frozen copies of
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

llms-full.txt and index.md SHALL be no older than the rule's `params.maxAgeHours` (4 hours).
Verified by `tests/audit/spec-cases.test.ts:123` (checkPresence freshness path).

#### Scenario: The staleness rules load as operational and are never case-run

- **GIVEN** `llms-full-txt-stale` and `index-md-stale` each declare `params.maxAgeHours` 4 and
  `rule_class: operational`
- **WHEN** the spec-cases harness loads the llms-txt catalog through `rules('llms-txt')`
- **THEN** both rules SHALL validate against the rule schema, which for an operational rule requires
  an `untested_rationale` and forbids `cases`, and the harness SHALL assert each carries no `cases`
  rather than case-running it

What that scenario does NOT prove: the 4-hour comparison itself. `checkPresence`
(`scripts/audit/validate-llms-txt.mjs:207`) computes `ageHours` from a live HTTP response, so no
pure-function case can exercise it and the covering test never calls it. That the production path
reads `params.maxAgeHours` from these rule files rather than a literal is true
(`scripts/audit/validate-llms-txt.mjs:130-131`) but is asserted by no test. See Gaps.

### Requirement: Conformance claims are anchored to the external convention

Every conformance rule SHALL carry `spec.verified_against_source` true against a SHA-pinned source,
and each normative quote SHALL still occur in that source.
Verified by `tests/audit/spec-cases.test.ts:124` (blocking).

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

| Requirement              | Unit                                       | Integration                               | Audit (prod)                                       | Provenance          |
| ------------------------ | ------------------------------------------ | ----------------------------------------- | -------------------------------------------------- | ------------------- |
| Served at contract paths | `cloudfront-proxy.test.ts` (fetch stubbed) | GAP (backend to proxy to served untested) | B5 lychee (the URL and its outbound links resolve) | —                   |
| Structural profile       | spec-cases + property test                 | — (external consumer)                     | weekly structural                                  | —                   |
| Shared-reference bytes   | `llms-structure.integrity.test.ts`         | producer consumes the same exact pin      | —                                                  | lockfile + sidecar  |
| Freshness                | GAP                                        | —                                         | weekly                                             | maxAgeHours in rule |
| External anchor          | spec-verification                          | —                                         | weekly drift                                       | pinned source       |

## Gaps

- No test spans the backend-to-CloudFront-to-proxy-to-served pipeline (the real integration seam).
  The proxy factory and its five routes are unit-tested against a stubbed `fetch`, so served
  correctness against real upstream content rests on the weekly audit alone.
- The upstream producer is out of this repo; nothing here asserts what it composes.
- Operational rules (fetch, freshness) have no unit cases by schema.
- llms.txt has no LLM_CONTENT_PATHS entry (llms-full and index.md do) — a contract asymmetry.

## Enforcement note

This repo has no `mantle check openspec` tooling. The `covers:` tethers in the covering test files
are instead enforced by the openspec-covers contract, consumed from
`@j0nathan-ll0yd/estate-contracts/openspec-covers` at `COVERS_SPEC_VERSION` 4 (atlas decisions 0079
item 4 wave 2b, 0080). It was vendored at `scripts/vendor/openspec-covers.mjs` until that migration;
the copy is gone and must not come back. `scripts/openspec-covers.mjs` wraps the package and runs
blocking via `pnpm run check:covers` and the `covers-conformance` job in
`.github/workflows/static-checks.yml`, on every pull request and every push to main.
