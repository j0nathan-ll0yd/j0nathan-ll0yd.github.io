# Bookshelf Render Conformance

## Purpose

Validate the behavioral rendering of the dashboard Bookshelf widget with the web fixture package.
Swift gallery states remain separately owned preview coverage; this specification proves only the
real web runtime. Render proof is behavioral DOM assertion, never screenshot comparison.

## Requirements

### Requirement: Loading state keeps the shelf in its loading presentation

While the books request is pending, the system SHALL keep the Bookshelf card in its loading
presentation. Server-rendered shelf cards may remain underneath that presentation until fresh data
arrives.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:49`.

### Requirement: Empty state renders empty state message without book cards

When rendering the empty state, the system SHALL display the empty state message and SHALL NOT display book cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:61`.

### Requirement: Default populated arrangement renders expected book cards

When rendering the default populated fixture, the system SHALL render the active, up-next, and
completed statuses with their expected book cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:69`.

### Requirement: All completed grouping renders completed section without active groups

When rendering the all-completed fixture, the system SHALL render the completed grouping without active or up-next sections.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:80`.

### Requirement: All in progress grouping renders active section without completed groups

When rendering the all-in-progress fixture, the system SHALL render the active grouping without completed or up-next sections.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:91`.

### Requirement: Sparse data renders sparse state without phantom cards

When the no-covers fixture is served, the system SHALL render every expected book card without
creating phantom books.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:101`.

### Requirement: Shelf capacity limits the visible book cards

When the export has more books than the dashboard shelf can display, the system SHALL retain the
first five visible shelf slots and omit later cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:110`.
