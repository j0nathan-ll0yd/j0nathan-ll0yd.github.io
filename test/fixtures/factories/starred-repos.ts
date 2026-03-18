import type { GithubStarredReposExport } from '../../../src/types/exports';
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
