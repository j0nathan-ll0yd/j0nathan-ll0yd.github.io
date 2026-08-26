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
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:81`.

#### Scenario: The card shows skeleton placeholders while theatre-reviews.json is outstanding

- **GIVEN** the dashboard loads with the theatre-reviews.json response held open
- **WHEN** the page reaches DOMContentLoaded before the review data arrives
- **THEN** the Theatre Reviews card SHALL be visible in its `is-loading` presentation showing nine
  skeleton bars, and SHALL render zero review cards

### Requirement: Empty state presents the theatre empty message without cards

When the theatre export contains no reviews, the system SHALL display the Theatre Reviews empty
message, display a zero review count, and SHALL NOT render review cards.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:93`.

#### Scenario: An empty export shows the empty message and a zero count

- **GIVEN** a theatre export that contains no reviews
- **WHEN** the Theatre Reviews card finishes loading
- **THEN** it SHALL show the "No reviews yet" empty message, SHALL read "0 reviews" in its count,
  and SHALL render zero review cards

### Requirement: Baseline reviews render every source title and count

When the baseline theatre fixture is served, the system SHALL render every review card and the
exported review count, including the source titles.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:102`.

#### Scenario: The baseline export renders every review and its count

- **GIVEN** the baseline theatre export of three reviews
- **WHEN** the Theatre Reviews card finishes loading
- **THEN** it SHALL read "3 reviews" in its count, SHALL render three review cards, and SHALL show
  the source titles "The Glass Menagerie", "Death of a Salesman" and "Waiting for Godot"

### Requirement: Grade variation renders the full letter-grade range

When reviews cover the available letter-grade range, the system SHALL render a grade badge for each
review and preserve the highest and lowest grades.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:113`.

#### Scenario: Every review carries a grade badge across the full letter range

- **GIVEN** a theatre export whose eight reviews span the available letter grades
- **WHEN** the Theatre Reviews card finishes loading
- **THEN** it SHALL render eight review cards with eight grade badges, showing both the highest
  grade "A+" and the lowest grade "F"

### Requirement: Reviews without images retain titles and grades without broken image elements

When reviews have no poster image, the system SHALL retain their cards, titles, and grades while
rendering no image element for the missing media.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:123`.

#### Scenario: Image-less reviews keep their cards and drop the image element

- **GIVEN** a theatre export whose three reviews carry no poster image
- **WHEN** the Theatre Reviews card finishes loading
- **THEN** it SHALL render three review cards with three grade badges and the title
  "Long Day's Journey Into Night", and SHALL render no image element inside the poster wrappers

### Requirement: Export window preserves total source count

When the export reports the total source count but carries only its seven-review public window,
the system SHALL show the total count while rendering exactly the exported cards.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:133`.

#### Scenario: The public window renders its own cards while reporting the source total

- **GIVEN** a theatre export carrying a seven-review public window and a source-wide total of 18
- **WHEN** the Theatre Reviews card finishes loading
- **THEN** it SHALL read "18 reviews" in its count while rendering exactly the seven exported cards

### Requirement: Full variation renders populated optimized-image review cards

When the fully populated fixture is served, the system SHALL render every review card with its
optimized poster image source, preserve the source title, and use safe outbound-link attributes.
Verified by `tests/behavioral/theatre-reviews-matrix.test.ts:143`.

#### Scenario: A fully populated export renders optimized posters and safe outbound links

- **GIVEN** the fully populated theatre export of eight reviews with poster images
- **WHEN** the Theatre Reviews card finishes loading
- **THEN** it SHALL render eight review cards, each with an AVIF `picture` source and a poster
  image, SHALL show the source title "A Midsummer Night's Dream", and SHALL give the first card
  `target="_blank"`, `rel="noopener noreferrer"` and its review permalink as `href`

