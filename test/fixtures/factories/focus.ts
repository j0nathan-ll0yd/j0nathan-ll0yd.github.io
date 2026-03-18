import type { FocusExport } from '../../../src/types/exports';
import { isoTimestamp } from './helpers';

export function createFocusFixture(
  overrides?: Partial<FocusExport>
): FocusExport {
  return {
    generatedAt: isoTimestamp(),
    currentFocus: 'Work',
    ...overrides,
  };
}
