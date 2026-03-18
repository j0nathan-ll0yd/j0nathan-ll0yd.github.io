# Fixture Validation Checklist

## How to Test

1. Run `npm run generate:fixtures` to write all JSON files to `test/fixtures/generated/`
2. Start dev server with a fixture set: `FIXTURE_SET=<name> npm run dev`
3. Open the relevant showcase page and check the card/widget matches the expected state below
4. To validate fixture JSON structure: `npm run validate:fixtures`

The fixture middleware intercepts `/api/live/*.json` requests. It tries `{FIXTURE_SET}.json` first, then falls back to `baseline.json`.

---

## Health Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | HR 63 bpm, Normal Zone, HRV 45ms green |
| bradycardia | `FIXTURE_SET=bradycardia` | HR 42 bpm blue, "Bradycardia" badge |
| tachycardia | `FIXTURE_SET=tachycardia` | HR 118 bpm red, "Tachycardia" badge |
| highHrv | `FIXTURE_SET=high-hrv` | HRV 95ms, green/excellent indicator |
| lowHrv | `FIXTURE_SET=low-hrv` | HRV 18ms, red/poor indicator |
| highSteps | `FIXTURE_SET=high-steps` | Steps 18,432, goal ring complete |
| lowActivity | `FIXTURE_SET=low-activity` | Steps 842, goal ring minimal |
| postWorkout | `FIXTURE_SET=post-workout` | Elevated HR, recovery zone indicator |
| staleData | `FIXTURE_SET=stale-data` | Timestamp warning, greyed values |
| noData | `FIXTURE_SET=no-data` | Empty state placeholder shown |

---

## Sleep Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | 7h 32m, 87% efficiency, normal stages |
| shortSleep | `FIXTURE_SET=short-sleep` | 4h 15m, warning indicator |
| longSleep | `FIXTURE_SET=long-sleep` | 9h 48m, oversleep indicator |
| poorEfficiency | `FIXTURE_SET=poor-efficiency` | < 70% efficiency, red badge |
| highEfficiency | `FIXTURE_SET=high-efficiency` | 96% efficiency, green badge |
| noRem | `FIXTURE_SET=no-rem` | REM stage absent or 0% |
| deepSleepHeavy | `FIXTURE_SET=deep-sleep-heavy` | Deep sleep > 25%, highlighted |
| fragmented | `FIXTURE_SET=fragmented` | Many awakenings shown |
| noData | `FIXTURE_SET=no-data` | Empty state for sleep card |

---

## Workouts Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | 3 recent workouts, mixed types |
| runOnly | `FIXTURE_SET=run-only` | All entries are running workouts |
| strengthOnly | `FIXTURE_SET=strength-only` | All entries are strength/gym |
| longRun | `FIXTURE_SET=long-run` | Single long run > 20km |
| highCalories | `FIXTURE_SET=high-calories` | Workouts with 800+ kcal each |
| empty | `FIXTURE_SET=empty` | No workouts — empty state shown |
| singleWorkout | `FIXTURE_SET=single-workout` | One workout entry |
| mixedTypes | `FIXTURE_SET=mixed-types` | Run, swim, cycle, strength mix |

---

## Books Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | 1 current book, 3 recent reads |
| reading | `FIXTURE_SET=reading` | Currently reading shown with progress |
| finishedRecently | `FIXTURE_SET=finished-recently` | Just-finished book prominent |
| manyBooks | `FIXTURE_SET=many-books` | Full shelf with 8+ entries |
| noCurrentBook | `FIXTURE_SET=no-current-book` | No in-progress book, shelf only |
| empty | `FIXTURE_SET=empty` | Empty bookshelf state |
| singleBook | `FIXTURE_SET=single-book` | One book total |
| longTitle | `FIXTURE_SET=long-title` | Book with very long title — no overflow |

---

## Location Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | Top 5 places, heatmap active |
| fewPlaces | `FIXTURE_SET=few-places` | Only 2 top places |
| manyPlaces | `FIXTURE_SET=many-places` | 8+ top places |
| noPlaces | `FIXTURE_SET=no-places` | No top places — empty radar |
| denseHeatmap | `FIXTURE_SET=dense-heatmap` | All 91 cells filled in heatmap |
| sparseHeatmap | `FIXTURE_SET=sparse-heatmap` | <10 cells filled in heatmap |
| emptyHeatmap | `FIXTURE_SET=empty-heatmap` | All heatmap cells empty |
| singleCategory | `FIXTURE_SET=single-category` | Only "Dining" category on radar |

---

## GitHub Events Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | Mixed push, PR, issue events |
| pushOnly | `FIXTURE_SET=push-only` | Only PushEvent entries |
| pullRequests | `FIXTURE_SET=pull-requests` | PR open/close/merge events |
| empty | `FIXTURE_SET=empty` | No events — empty feed |
| singleEvent | `FIXTURE_SET=single-event` | One event entry |
| manyEvents | `FIXTURE_SET=many-events` | 20+ events in feed |
| multiRepo | `FIXTURE_SET=multi-repo` | Events across 5+ repositories |

---

## GitHub Starred Repos Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | 6 repos, mixed languages |
| empty | `FIXTURE_SET=empty` | No starred repos — empty state |
| singleRepo | `FIXTURE_SET=single-repo` | One starred repo |
| manyRepos | `FIXTURE_SET=many-repos` | 15+ repos listed |
| rustHeavy | `FIXTURE_SET=rust-heavy` | Majority Rust language repos |
| longDescription | `FIXTURE_SET=long-description` | Repo with very long description |

---

## Articles Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | 5 recent articles |
| empty | `FIXTURE_SET=empty` | No articles — empty state |
| singleArticle | `FIXTURE_SET=single-article` | One article entry |
| manyArticles | `FIXTURE_SET=many-articles` | 12+ articles |
| longTitle | `FIXTURE_SET=long-title` | Article with very long title |

---

## Focus Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | Normal focus sessions today |
| noSessions | `FIXTURE_SET=no-sessions` | No focus sessions — empty state |
| longSession | `FIXTURE_SET=long-session` | Single session > 2 hours |
| manySessions | `FIXTURE_SET=many-sessions` | 8+ sessions in a day |
| deepFocus | `FIXTURE_SET=deep-focus` | High focus score indicator |

---

## Theatre Reviews Fixtures

| Variation | Command | Expected State |
|-----------|---------|---------------|
| baseline | `FIXTURE_SET=baseline` | 3 recent reviews with ratings |
| empty | `FIXTURE_SET=empty` | No reviews — empty state |
| singleReview | `FIXTURE_SET=single-review` | One show reviewed |
| manyReviews | `FIXTURE_SET=many-reviews` | 8+ reviews in list |
| highRatings | `FIXTURE_SET=high-ratings` | All 5-star reviews |
| lowRatings | `FIXTURE_SET=low-ratings` | Mix of 1-2 star reviews |
| longReview | `FIXTURE_SET=long-review` | Review with very long text |
