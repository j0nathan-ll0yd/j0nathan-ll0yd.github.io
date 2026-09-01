# Reading Feed Render Conformance

## Purpose

Validate the behavioral rendering of the dashboard Reading Feed widget against the web fixture
package. Render proof is behavioral DOM assertion, never screenshot comparison: the reading-feed
screenshots in the visual suite are supplementary and are not this capability's proving oracle.

Two independent caps stack on this widget and are easy to confuse, so each carries its own
requirement below. The adapter keeps the thirty most recently saved articles; the updater then
paginates whatever survives at ten rows per page. Relative dates are deliberately unspecified here:
they are computed against the reader's clock, so pinning them would encode a wall-clock boundary as
a conformance fact.

## Requirements

### Requirement: Loading state keeps the reading feed in its loading presentation

While the articles request is pending, the system SHALL keep the Reading Feed card in its loading
presentation. The server-rendered rows may remain underneath that presentation until fresh data
arrives.
Verified by `tests/behavioral/articles-matrix.test.ts:18`.

#### Scenario: The feed stays in its loading presentation while articles.json is outstanding

- **GIVEN** the dashboard loads with the articles.json response held open
- **WHEN** the page reaches DOMContentLoaded before the article data arrives
- **THEN** the Reading Feed card SHALL still be visible carrying its `is-loading` presentation

### Requirement: Empty state renders the reading-feed empty message without article rows

When the articles export contains no articles, the system SHALL display the Reading Feed empty
message and SHALL NOT render article rows or pagination.
Verified by `tests/behavioral/articles-matrix.test.ts:30`.

#### Scenario: An empty export shows the empty message and no rows

- **GIVEN** an articles export that contains no articles
- **WHEN** the Reading Feed card finishes loading
- **THEN** it SHALL show the "No articles yet" empty message and SHALL render zero article rows and
  zero pagination buttons

### Requirement: Baseline articles render every title, its source and its outbound link

When the baseline articles fixture is served, the system SHALL render one row per article carrying
its title, its parenthetical source, and a safe outbound link, and SHALL omit pagination for a
single-page feed.
Verified by `tests/behavioral/articles-matrix.test.ts:42`.

#### Scenario: A five-article export renders five sourced rows and no pager

- **GIVEN** the baseline articles export of five titled articles
- **WHEN** the Reading Feed card finishes loading
- **THEN** it SHALL render five rows each carrying a parenthetical source, the first reading
  "Ask HN: How do you manage technical debt at scale" from "(Hacker News)" and linking to its
  article URL with `target="_blank"` and `rel="noopener noreferrer"`, and SHALL render no
  pagination button

### Requirement: An untitled article promotes its source and suppresses the duplicate parenthetical

When an article carries no title, the system SHALL render its source in the title slot so the row
never renders blank, and SHALL suppress that row's parenthetical source so the same string is not
printed twice.
Verified by `tests/behavioral/articles-matrix.test.ts:66`.

#### Scenario: A mixed export renders untitled rows by source and keeps the titled row sourced

- **GIVEN** an articles export of two untitled articles from one source followed by one titled
  article
- **WHEN** the Reading Feed card finishes loading
- **THEN** the two untitled rows SHALL render their source as the title, the card SHALL carry
  exactly one parenthetical source, and the titled row SHALL keep both its title and its
  "(Hacker News)" source

### Requirement: Annotated articles render a note affordance carrying the note text

When an article carries reader notes, the system SHALL render a note affordance on that row whose
text carries every note comment joined together, rather than one affordance per comment.
Verified by `tests/behavioral/articles-matrix.test.ts:83`.

#### Scenario: A three-article annotated export renders one affordance per row

- **GIVEN** an articles export of three articles, the first carrying two note comments and the
  second carrying one
- **WHEN** the Reading Feed card finishes loading
- **THEN** it SHALL render three rows with three note affordances, the first carrying both of its
  comments joined into a single title and the second carrying its one comment

### Requirement: An oversized feed paginates at ten rows per page

When the feed holds more articles than one page, the system SHALL render ten rows per page with one
button per page, marking the current page, and SHALL swap the rendered slice when another page is
selected.
Verified by `tests/behavioral/articles-matrix.test.ts:97`.

#### Scenario: A twenty-five-article export pages ten, ten and five

- **GIVEN** an articles export of twenty-five articles
- **WHEN** the Reading Feed card finishes loading and the third page is selected
- **THEN** the first page SHALL render ten rows under three page buttons with the first marked
  current, and the third page SHALL render the five-article remainder with the third button marked
  current and the first page's rows gone

### Requirement: The feed caps the export at thirty articles

When the export holds more than thirty articles, the system SHALL retain only the thirty most
recently saved and SHALL drop the remainder before paginating.
Verified by `tests/behavioral/articles-matrix.test.ts:118`.

#### Scenario: A forty-article export renders exactly three pages ending at the thirtieth

- **GIVEN** an articles export of forty articles
- **WHEN** the Reading Feed card finishes loading and the last page is selected
- **THEN** the pager SHALL offer exactly three pages, the last SHALL render ten rows ending with
  the thirtieth article, and the thirty-first SHALL be absent from the card entirely
