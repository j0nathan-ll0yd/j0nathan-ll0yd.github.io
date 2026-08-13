# LLM Content Discovery (llms.txt)

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
- Checker: `validateLlmsTxt(rawText)` — `scripts/audit/validate-llms-txt.mjs:39`
- Finding: `{ id, severity: 'fail' | 'warn', message }` — currently structural. The severity enum is
  declared in `scripts/audit/specs/rule.schema.json:126` and stamped by `emit()`, never chosen by the
  validator. Proposed follow-up: a named `LlmsFinding` typedef so the output shape is specified,
  not implied.

## Requirements

### Requirement: Discovery index and full dump are served at the contract paths

The system SHALL serve /llms.txt, /llms-full.txt, and /index.md, each with its declared
content-type. /llms-full.txt and /index.md SHALL resolve from `LLM_CONTENT_PATHS`; /llms.txt has
no such constant.
Verified by `tests/unit/cloudfront-proxy.test.ts:57` (all five proxy routes: upstream URL, status,
content-type) and `:44` (502 plain-text notice when upstream fails). GAP: the test stubs `fetch`,
so nothing exercises the live backend-to-CloudFront-to-proxy path.

#### Scenario: Advertised path resolves

- **GIVEN** an agent fetches a path advertised in the llms.txt index
- **WHEN** the proxy handles the request
- **THEN** the system SHALL return the upstream content with the declared content-type

### Requirement: Served llms.txt conforms to the llmstxt.org structure

The served llms.txt SHALL begin with an H1, SHALL follow it with a summary blockquote, SHALL
contain exactly one H1, and every H2 file-list item SHALL be a markdown link.
Verified by `tests/audit/spec-cases.test.ts` (the five convention rules, derived cases) and
`tests/audit/validate-llms-txt.property.test.ts:84` (the four structural invariants as properties,
tethered by the `covers:` comment at `:83`).

#### Scenario: A well-formed index passes every structural rule

- **GIVEN** a served llms.txt with an H1, a summary blockquote, and linked H2 items
- **WHEN** validateLlmsTxt runs
- **THEN** it SHALL emit no fail-severity structural finding

### Requirement: Full-content artifacts stay fresh

llms-full.txt and index.md SHALL be no older than the rule's `params.maxAgeHours` (4 hours).
Verified by the `scripts/audit/validate-llms-txt.mjs` freshness path (`checkPresence` at `:127`,
the age comparison at `:163`, the threshold read from the rule file at `:203-204`) — GAP at unit:
operational rules carry no cases by schema, so only the weekly audit exercises this. The rule
files record this as N3, "derived but unverifiable".

### Requirement: Conformance claims are anchored to the external convention

Every conformance rule SHALL carry `spec.verified_against_source` true against a SHA-pinned source,
and each normative quote SHALL still occur in that source.
Verified by `scripts/audit/check-spec-verification.mjs` (blocking) and
`scripts/audit/check-spec-drift.mjs` (weekly).

## Validation matrix

| Requirement              | Unit                                       | Integration                               | Audit (prod)                                       | Provenance          |
| ------------------------ | ------------------------------------------ | ----------------------------------------- | -------------------------------------------------- | ------------------- |
| Served at contract paths | `cloudfront-proxy.test.ts` (fetch stubbed) | GAP (backend to proxy to served untested) | B5 lychee (the URL and its outbound links resolve) | —                   |
| Structural conformance   | spec-cases + property test                 | — (external consumer)                     | weekly structural                                  | —                   |
| Freshness                | GAP                                        | —                                         | weekly                                             | maxAgeHours in rule |
| External anchor          | spec-verification                          | —                                         | weekly drift                                       | pinned source       |

## Gaps

- No test spans the backend-to-CloudFront-to-proxy-to-served pipeline (the real integration seam).
  The proxy factory and its five routes are unit-tested against a stubbed `fetch`, so served
  correctness against real upstream content rests on the weekly audit alone.
- The upstream producer is out of this repo; nothing here asserts what it composes.
- Operational rules (fetch, freshness) have no unit cases by schema.
- llms-small.txt exists in the contract but has no proxy and no check.
- llms.txt has no LLM_CONTENT_PATHS entry (llms-full and index.md do) — a contract asymmetry.

## Enforcement note

This repo has no `mantle check openspec` tooling, so the `covers:` tethers in the covering test
files are authored for humans and a future gate, not machine-enforced yet. Adding a lightweight
covers check is a follow-up.
