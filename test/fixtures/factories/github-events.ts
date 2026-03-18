import type { GithubEventsExport } from '../../../src/types/exports';
import { isoDate, isoTimestamp } from './helpers';

export function createEvent(
  overrides?: Partial<GithubEventsExport['events'][number]>
): GithubEventsExport['events'][number] {
  return {
    type: 'commit',
    repo: 'j0nathan-ll0yd/mantle',
    title: 'Fix type error in schema validation',
    date: isoDate(),
    hash: 'a1b2c3d',
    additions: 12,
    deletions: 3,
    ...overrides,
  };
}

export function createGithubEventsFixture(
  overrides?: Partial<GithubEventsExport>
): GithubEventsExport {
  return {
    generatedAt: isoTimestamp(),
    events: [
      createEvent({
        type: 'commit',
        repo: 'j0nathan-ll0yd/mantle',
        title: 'Add Aurora DSQL migration support',
        date: isoDate(),
        hash: 'a1b2c3d',
        additions: 45,
        deletions: 8,
      }),
      createEvent({
        type: 'commit',
        repo: 'j0nathan-ll0yd/j0nathan-ll0yd.github.io',
        title: 'Update location widget styles',
        date: isoDate(),
        hash: 'e4f5g6h',
        additions: 22,
        deletions: 11,
      }),
      createEvent({
        type: 'commit',
        repo: 'j0nathan-ll0yd/mantle',
        title: 'Fix permissions regeneration after table changes',
        date: isoDate(),
        hash: 'i7j8k9l',
        additions: 7,
        deletions: 2,
      }),
      createEvent({
        type: 'pr_merged',
        repo: 'j0nathan-ll0yd/j0nathan-ll0yd.github.io',
        title: 'Add theatre reviews widget',
        date: isoDate(),
        number: 42,
      }),
      createEvent({
        type: 'pr_opened',
        repo: 'j0nathan-ll0yd/mantle',
        title: 'Implement unified type sync pipeline',
        date: isoDate(),
        number: 17,
      }),
    ],
    ...overrides,
  };
}
