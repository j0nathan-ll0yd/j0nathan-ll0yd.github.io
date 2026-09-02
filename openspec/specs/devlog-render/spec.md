# Dev Activity Log Render Conformance

## Purpose

Validate the behavioral rendering of the dashboard Dev Activity Log widget -- the GitHub event feed
-- against the web fixture package. Render proof is behavioral DOM assertion, never screenshot
comparison: the dev-log screenshots in the visual suite are supplementary and are not this
capability's proving oracle.

The detail slot is type-dependent and its precedence is load-bearing: a commit carrying a hash
renders a diffstat, and any other event carrying a number renders that number. The baseline export
ships pull requests that carry BOTH a hash and a number, so the requirements below pin the
precedence rather than merely exercising one branch. Relative dates are deliberately unspecified:
they are computed against the reader's clock.

## Requirements

### Requirement: Loading state keeps the dev log in its loading presentation

While the GitHub events request is pending, the system SHALL keep the Dev Log card in its loading
presentation. The server-rendered lines may remain underneath that presentation until fresh data
arrives.
Verified by `tests/behavioral/devlog-matrix.test.ts:16`.

#### Scenario: The log stays in its loading presentation while github-events.json is outstanding

- **GIVEN** the dashboard loads with the github-events.json response held open
- **WHEN** the page reaches DOMContentLoaded before the event data arrives
- **THEN** the Dev Log card SHALL still be visible carrying its `is-loading` presentation

### Requirement: Empty state renders the dev-log empty message without activity lines

When the events export contains no events, the system SHALL display the Dev Log empty message and
SHALL NOT render activity lines.
Verified by `tests/behavioral/devlog-matrix.test.ts:28`.

#### Scenario: An empty export shows the empty message and no lines

- **GIVEN** a GitHub events export that contains no events
- **WHEN** the Dev Log card finishes loading
- **THEN** it SHALL show the "No recent activity" empty message and SHALL render zero activity lines

### Requirement: Baseline activity renders one line per event with its repo and title

When the baseline events fixture is served, the system SHALL render one line per event carrying its
repository, its title, and safe outbound-link attributes.
Verified by `tests/behavioral/devlog-matrix.test.ts:38`.

#### Scenario: A five-event export renders five titled lines

- **GIVEN** the baseline GitHub events export of three commits, one merged pull request and one
  opened pull request
- **WHEN** the Dev Log card finishes loading
- **THEN** it SHALL render five lines reading "Add component catalog fleet generation",
  "Fix reading-feed items hidden by an animation race" and
  "Stop advertising the retired llms-small.txt" among them, each carrying `target="_blank"` and
  `rel="noopener noreferrer"`

### Requirement: Repository names are rendered without their owner prefix

When rendering an event, the system SHALL render only the repository segment of its full name, and
SHALL retain the fully qualified name in the outbound link.
Verified by `tests/behavioral/devlog-matrix.test.ts:54`.

#### Scenario: An owner-qualified export renders bare repository names but qualified links

- **GIVEN** the baseline export, whose every event names its repository as `j0nathan-ll0yd/<repo>`
- **WHEN** the Dev Log card finishes loading
- **THEN** the lines SHALL read "design-system-Lifegames" and "j0nathan-ll0yd.github.io" without
  the owner prefix, the owner-qualified `j0nathan-ll0yd/design-system-Lifegames` SHALL appear
  nowhere in the card's text, and the first line's href SHALL still carry the fully qualified
  repository

### Requirement: Commit events render their additions and deletions and link to the commit

When an event is a commit carrying a hash, the system SHALL render its additions and deletions as
the line detail, including a zero count, and SHALL link to that commit.
Verified by `tests/behavioral/devlog-matrix.test.ts:72`.

#### Scenario: A commits-only export renders a diffstat on every line

- **GIVEN** a GitHub events export of five commits, the first adding ten lines and deleting none
- **WHEN** the Dev Log card finishes loading
- **THEN** it SHALL render five lines each carrying a detail, the first reading "+10 -0" and
  linking to its commit URL, and the last reading "+50 -12"

### Requirement: Pull-request events render their number and link to the pull request

When an event is a pull request carrying a number, the system SHALL render that number as the line
detail and SHALL link to the pull request.
Verified by `tests/behavioral/devlog-matrix.test.ts:87`.

#### Scenario: A pull-request-only export renders numbered lines linking to each pull request

- **GIVEN** a GitHub events export of five pull requests numbered 42 through 206 across two
  repositories
- **WHEN** the Dev Log card finishes loading
- **THEN** it SHALL render five lines whose details read "#42" and "#206", each linking to that
  pull request under its own repository

### Requirement: The log caps the feed at ten events

When the export holds more than ten events, the system SHALL render only the first ten and SHALL
drop the remainder before rendering.
Verified by `tests/behavioral/devlog-matrix.test.ts:101`.

#### Scenario: A fifteen-event export renders exactly ten lines

- **GIVEN** a GitHub events export of fifteen events
- **WHEN** the Dev Log card finishes loading
- **THEN** it SHALL render exactly ten lines, retaining the tenth event's title and rendering
  neither the eleventh nor the twelfth anywhere in the card
