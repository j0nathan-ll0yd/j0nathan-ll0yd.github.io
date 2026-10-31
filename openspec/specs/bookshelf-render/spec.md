# Bookshelf Render Conformance

## Purpose

Validate the behavioral rendering of the dashboard Bookshelf widget with the web fixture package.
Swift gallery states remain separately owned preview coverage; this specification proves only the
real web runtime. Render proof is behavioral DOM assertion, never screenshot comparison.

## Requirements

### Requirement: Loading state keeps the shelf in its loading presentation

While the books request is pending, the system SHALL keep the Bookshelf card in its loading
presentation. The data-free fallback page (`dashboard-shell`), which the Worker serves when a server
render misses its budget (`dashboard-ssr`), renders no items, so the card shows only its skeleton and a
hidden, empty scaffold until fresh data arrives.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:62`.

#### Scenario: The shelf stays in its loading presentation while books.json is outstanding

- **GIVEN** the Worker serves the data-free fallback page and the dashboard loads with the books.json response held open
- **WHEN** the page reaches DOMContentLoaded before the books data arrives
- **THEN** the Bookshelf card SHALL still be visible carrying its `is-loading` presentation

### Requirement: Empty state renders empty state message without book cards

When rendering the empty state, the system SHALL display the empty state message and SHALL NOT display book cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:74`.

#### Scenario: An empty export shows the empty message and no book cards

- **GIVEN** a books export that contains no books
- **WHEN** the Bookshelf card finishes loading
- **THEN** it SHALL show its empty-state message and SHALL render zero book cards

### Requirement: Default populated arrangement renders expected book cards

When rendering the default populated fixture, the system SHALL render the active, up-next, and
completed statuses with their expected book cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:84`.

#### Scenario: The baseline export renders one card per status

- **GIVEN** the baseline books export
- **WHEN** the Bookshelf card finishes loading
- **THEN** it SHALL render five book cards -- one active, one up-next and three finished -- including
  "The Tainted Cup" and "Crafting Engineering Strategy"

### Requirement: All completed grouping renders completed section without active groups

When rendering the all-completed fixture, the system SHALL render the completed grouping without active or up-next sections.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:98`.

#### Scenario: An all-finished export renders no reading chrome

- **GIVEN** a books export in which every book is finished
- **WHEN** the Bookshelf card finishes loading
- **THEN** it SHALL render five cards all marked finished, and SHALL render no active card and no
  progress element

### Requirement: All in progress grouping renders active section without completed groups

When rendering the all-in-progress fixture, the system SHALL render the active grouping without completed or up-next sections.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:110`.

#### Scenario: An all-reading export renders progress and no finished chrome

- **GIVEN** a books export in which every book is in progress
- **WHEN** the Bookshelf card finishes loading
- **THEN** it SHALL render three active cards each carrying a progress element, and SHALL render no
  finished card

### Requirement: Sparse data renders sparse state without phantom cards

When the no-covers fixture is served, the system SHALL render every expected book card without
creating phantom books.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:122`.

#### Scenario: A cover-less export renders every real book and invents none

- **GIVEN** a books export whose entries carry no cover artwork of their own
- **WHEN** the Bookshelf card finishes loading
- **THEN** it SHALL render exactly five book cards, each with a cover image in its wrapper, and
  SHALL include "Foundryside" -- no phantom card is added to fill the shelf

### Requirement: Shelf capacity limits the visible book cards

When the export has more books than the dashboard shelf can display, the system SHALL retain the
first five visible shelf slots and omit later cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:133`.

#### Scenario: An oversized export is capped at the five visible slots

- **GIVEN** a books export holding more books than the shelf's five slots
- **WHEN** the Bookshelf card finishes loading
- **THEN** it SHALL render exactly five cards, retaining the first-slot "The Tainted Cup" and
  omitting the later "JavaScript: The Good Parts"


### Requirement: Each book card links to its book without JavaScript

The server render SHALL wrap the title text of every Bookshelf card in one link to that book: an
`a.shelf-book-link` inside `.shelf-book-title`, carrying exactly `class`, `href` (the design
system's `amazonBookUrl(asin)`, query string included), `target="_blank"` and
`rel="sponsored noopener noreferrer"`. The cover image SHALL carry `alt=""`, so the link alone
names the book. Server markup SHALL NOT carry `aria-haspopup`; the book-modal enhancement SHALL add
`aria-haspopup="dialog"` to each link once it binds. With the enhancement bound, a plain primary
click on the link SHALL open the book dialog and SHALL NOT navigate; a click with a modifier key
SHALL navigate to the book and SHALL NOT open the dialog. The composed-page fragment policy admits
this link only in that exact shape (`BOOK_LINK` in `src/lib/composed/fragment-policy.ts`).
Verified by `tests/behavioral/ssr-no-js.test.ts:158` (JavaScript off) and
`tests/behavioral/bookshelf-matrix.test.ts:147` (the dialog enhancement).

#### Scenario: A visitor without JavaScript reaches each book

- **GIVEN** the Worker serves the composed page from the known-answer books export
- **WHEN** a client with JavaScript off reads the Bookshelf card
- **THEN** every card SHALL carry one `a.shelf-book-link` around its title text, with the exact
  `amazonBookUrl` href, `target="_blank"`, `rel="sponsored noopener noreferrer"` and no
  `aria-haspopup`, and its cover SHALL carry `alt=""`

#### Scenario: A plain click opens the dialog, a modified click navigates

- **GIVEN** the dashboard has loaded and the book-modal enhancement has bound
- **WHEN** a visitor clicks a book card link with no modifier key
- **THEN** the book dialog SHALL open for that book and the page SHALL NOT navigate or open a tab
- **AND WHEN** the visitor Ctrl-clicks or Cmd-clicks the link
- **THEN** a new tab SHALL open at the book's `amazonBookUrl` and the dialog SHALL stay closed
