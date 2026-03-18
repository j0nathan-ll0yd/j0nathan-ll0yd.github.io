import type { FocusExport } from '../../../src/types/exports';
import { createFocusFixture } from '../factories/focus';

export const focusVariations: Record<string, FocusExport> = {
  baseline: createFocusFixture({ currentFocus: 'Work' }),

  dnd: createFocusFixture({ currentFocus: 'Do Not Disturb' }),

  noFocus: createFocusFixture({ currentFocus: '' }),

  personal: createFocusFixture({ currentFocus: 'Personal' }),
};
