# Behavioral matrices and the per-widget accessibility gate

The suites in this directory assert DOM and interaction behavior against the real production
build. They take no screenshots. Run them with `pnpm run test:behavioral` (Docker, CI parity);
CI runs them in the `behavioral` job of `.github/workflows/visual-tests.yml`.

Since atlas phoenix-eval GAP 4 (widget check W16), every state the two conformance matrices render
also gets a scoped `axe-core` scan of that widget's own card.

## What the scan does

- `tests/behavioral/a11y.ts` — `expectNoNewAxeViolations(page, key)`, called once per rendered
  state, immediately after that state's existing assertions.
- `tests/behavioral/a11y-scan-targets.ts` — the declared list of `<widget>/<state>` scan keys and
  the card selector each is scoped to.
- `tests/behavioral/a11y-baseline.json` — the grandfathered debt (see the ratchet below).
- `tests/unit/a11y-baseline.test.ts` — structural checks on the baseline, in the fast `pnpm
run test:unit` lane.

The scan is scoped to ONE card, never to the page. The whole-page verdict belongs to the weekly B4
`pa11y-ci` lane (`.github/workflows/audit-web.yml`); duplicating it here would refile one page-level
finding against every widget that happens to share the dashboard.

Rule set: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`. Axe's `best-practice` rules are excluded
deliberately — they encode opinions rather than success criteria.

Blocking severity: axe impact `serious` and `critical` only.

## The ratchet

Most widgets on this dashboard had never been a11y-tested. Rather than fix everything at once (scope
creep) or suppress silently, pre-existing serious/critical violations are grandfathered into
`a11y-baseline.json`, in the same shape the estate already uses
(`mantle-LifegamesPortal/openspec/covers-baseline.json`,
`design-system-Lifegames/contracts/component-catalog/conformance-baseline.json`).

| Situation                                                 | Verdict                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| a serious/critical violation NOT listed for that scan key | **FAIL**                                                       |
| a serious/critical violation listed for that key          | pass, carried as recorded debt                                 |
| a listed rule that no longer fires                        | pass, reported as `PRUNABLE` on stdout                         |
| a baseline key naming no declared scan target             | **FAIL** (`tests/unit/a11y-baseline.test.ts`)                  |
| a missing or malformed baseline file                      | **FAIL** — a gate that greens on a missing input is not a gate |

Regenerate with `pnpm run a11y:update-baseline` (runs the suite in Docker with
`A11Y_UPDATE_BASELINE=1`, then merges via `scripts/update-a11y-baseline.mjs`). The merge REPLACES
rather than unions, so a fixed violation drops out; it refuses to write unless the run covered every
declared scan key.

Fix violations at the widget in `design-system-Lifegames` — this repo contains no widget source —
never by narrowing the tag set or excluding a node.

## The honest ceiling — read this before citing a green run

**This is an automated FLOOR. It is not WCAG conformance and must never be reported as such.**

- Automated scanning catches roughly **57% of accessibility issue volume** and maps to about **32%
  of WCAG success criteria**.
- **Focus Order (WCAG 2.4.3) and Focus Visible (WCAG 2.4.7) are 100% manual.** Nothing here touches
  them.
- **Contrast (WCAG 1.4.3) is not covered on this site either.** Measured 2026-08-31 against
  axe-core 4.13 in the Playwright noble image: `color-contrast` returns `inapplicable` for every
  card-scoped scan and `incomplete` for a whole-page scan of the same DOM. The cards are translucent
  over an animated gradient, so axe cannot resolve a background colour and declines to rule either
  way. Neither this lane nor B4 pa11y can report a contrast defect here. Treat contrast as manual.
- Screen-reader comprehensibility, whether alt text is _meaningful_ rather than merely present,
  heading order in context, and keyboard operability of custom widgets are all outside what axe can
  decide.

A green run is evidence that a specific class of defect is absent from the scanned card. It is not
evidence that the widget is accessible.

## Coverage today

Two widgets have behavioral matrices, so two widgets are scanned: `bookshelf` (`#cardBooks`) and
`theatre-reviews` (`#cardTheatreReviews`), seven states each. The other 31 widgets in the design
system have no matrix and are therefore unscanned here — that gap is tracked as `behavioralGap` in
the DS conformance baseline, and each widget gains this scan when it gains a matrix.
