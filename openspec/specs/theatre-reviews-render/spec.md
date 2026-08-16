# Theatre Reviews Render Conformance

## Purpose

Validate the Theatre Reviews dashboard widget against deterministic web scenarios. The Swift
gallery owns a separate preview-fixture family; it is not a cross-platform canonical fixture set.
Render proof is behavioral: the production dashboard loads CloudFront responses and asserts visible
cards, counts, grades, images, links, and empty/loading semantics. Screenshot comparison is
supplementary and is never this capability's proving oracle.

## Requirements

### Requirement: Loading skeleton renders placeholders before review data arrives

While the theatre-reviews request is pending, the system SHALL show the Theatre Reviews loading
placeholders and SHALL NOT render review cards.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:66`.

### Requirement: Empty state presents the theatre empty message without cards

When the theatre export contains no reviews, the system SHALL display the Theatre Reviews empty
message, display a zero review count, and SHALL NOT render review cards.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:78`.

### Requirement: Baseline reviews render every source title and count

When the baseline theatre fixture is served, the system SHALL render every review card and the
exported review count, including the source titles.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:87`.

### Requirement: Grade variation renders the full letter-grade range

When reviews cover the available letter-grade range, the system SHALL render a grade badge for each
review and preserve the highest and lowest grades.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:99`.

### Requirement: Reviews without images retain titles and grades without broken image elements

When reviews have no poster image, the system SHALL retain their cards, titles, and grades while
rendering no image element for the missing media.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:109`.

### Requirement: Export window preserves total source count

When the export reports the total source count but carries only its seven-review public window,
the system SHALL show the total count while rendering exactly the exported cards.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:120`.

### Requirement: Full variation renders populated optimized-image review cards

When the fully populated fixture is served, the system SHALL render every review card with its
optimized poster image source, preserve the source title, and use safe outbound-link attributes.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:129`.
