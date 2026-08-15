# Bookshelf Render Conformance

## Purpose

Validate the behavioral rendering of the Bookshelf widget across all 10 canonical state permutations specified in Decision 0047. Render proof is behavioral (DOM structure, headings, card counts, focus/dialog semantics), never visual screenshot comparison.

## Requirements

### Requirement: Loading skeleton state renders loading indicators without book sections

When rendering the loading skeleton state, the system SHALL display loading structure indicators and SHALL NOT display book sections or cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:6`.

### Requirement: Empty state renders empty state message without book cards

When rendering the empty state, the system SHALL display the empty state message and SHALL NOT display book cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:12`.

### Requirement: Default populated arrangement renders expected book cards

When rendering the default populated fixture, the system SHALL render the active, up-next, and completed sections with expected book cards.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:18`.

### Requirement: Minimum populated arrangement renders single book card

When rendering the minimum populated fixture, the system SHALL render a single book card.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:24`.

### Requirement: Maximum populated arrangement renders all book cards

When rendering the maximum populated fixture, the system SHALL render all expected book cards without truncated overflow errors.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:30`.

### Requirement: All completed grouping renders completed section without active groups

When rendering the all-completed fixture, the system SHALL render the completed grouping without active or up-next sections.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:36`.

### Requirement: All in progress grouping renders active section without completed groups

When rendering the all-in-progress fixture, the system SHALL render the active grouping without completed or up-next sections.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:42`.

### Requirement: Dense shelf renders all books as reachable items

When rendering the dense shelf fixture, the system SHALL ensure all expected cards are reachable in the DOM hierarchy.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:48`.

### Requirement: Mixed state renders active queued and completed groupings

When rendering the mixed fixture, the system SHALL keep active, queued, and completed groupings visually and semantically distinguishable.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:54`.

### Requirement: Sparse data renders sparse state without phantom cards

When rendering the mostly-empty fixture, the system SHALL NOT render phantom cards or empty sections.
Verified by `tests/behavioral/bookshelf-matrix.test.ts:60`.
