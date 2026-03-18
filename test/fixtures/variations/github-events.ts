import type { GithubEventsExport } from '../../../src/types/exports';
import { createGithubEventsFixture, createEvent } from '../factories/github-events';
import { isoDate, isoTimestamp } from '../factories/helpers';

export const githubEventsVariations: Record<string, GithubEventsExport> = {
  baseline: createGithubEventsFixture(),

  empty: createGithubEventsFixture({ events: [] }),

  commitsOnly: createGithubEventsFixture({
    events: Array.from({ length: 5 }, (_, i) =>
      createEvent({
        type: 'commit',
        repo: i % 2 === 0 ? 'j0nathan-ll0yd/mantle' : 'j0nathan-ll0yd/j0nathan-ll0yd.github.io',
        title: `Commit number ${i + 1} in the sequence`,
        hash: `abc${i}def`,
        additions: (i + 1) * 10,
        deletions: i * 3,
        date: isoDate(),
      })
    ),
  }),

  prsOnly: createGithubEventsFixture({
    events: Array.from({ length: 5 }, (_, i) =>
      createEvent({
        type: i % 2 === 0 ? 'pr_merged' : 'pr_opened',
        repo: 'j0nathan-ll0yd/mantle',
        title: `Pull request number ${i + 1}`,
        number: i + 1,
        date: isoDate(),
        hash: undefined,
        additions: undefined,
        deletions: undefined,
      })
    ),
  }),

  overTen: createGithubEventsFixture({
    events: Array.from({ length: 15 }, (_, i) =>
      createEvent({
        type: i % 3 === 0 ? 'pr_merged' : 'commit',
        repo: i % 2 === 0 ? 'j0nathan-ll0yd/mantle' : 'j0nathan-ll0yd/j0nathan-ll0yd.github.io',
        title: `Event item ${i + 1} in large set`,
        date: isoDate(),
        hash: i % 3 !== 0 ? `hash${i}` : undefined,
        number: i % 3 === 0 ? i + 1 : undefined,
        additions: i % 3 !== 0 ? i * 5 : undefined,
        deletions: i % 3 !== 0 ? i * 2 : undefined,
      })
    ),
    generatedAt: isoTimestamp(),
  }),
};
