import type { GithubStarredReposExport } from '@lifegames/portal-contract/schemas';
import { isoTimestamp } from './helpers';

export function createStarredReposFixture(
  overrides?: Partial<GithubStarredReposExport>
): GithubStarredReposExport {
  return {
    generatedAt: isoTimestamp(),
    repos: [],
    ...overrides,
  };
}
