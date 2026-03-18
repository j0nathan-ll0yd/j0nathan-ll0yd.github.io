import type { GithubStarredReposExport } from '../../../src/types/exports';
import { createStarredReposFixture } from '../factories/starred-repos';

export const starredReposVariations: Record<string, GithubStarredReposExport> = {
  baseline: createStarredReposFixture(),

  oldTimestamp: createStarredReposFixture({
    generatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  }),
};
