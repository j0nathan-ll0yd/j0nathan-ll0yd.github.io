import {createBaseConfig} from '@j0nathan-ll0yd/config/eslint'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Estate-standard flat config (@j0nathan-ll0yd/config). Formatting is owned by
// dprint; this only enforces lint rules. Type-aware rules are enabled via
// `tsconfigRootDir`, so every type-aware-linted file must be in tsconfig.json's
// project graph. tests/** and audits/__tests__/** are excluded there, so they are
// ignored here too (bringing tests under type-aware lint needs a dedicated tests
// tsconfig -- a separate change). audits/__tests__/ is the audit-suite root moved
// out of tests/audit/ by atlas decision 0111 phase 2b; the exclusion moved with it.
export default [
  {
    ignores: [
      'dist/**',
      '.astro/**',
      'coverage/**',
      'node_modules/**',
      'previews/**',
      'playwright-report/**',
      'test-results/**',
      'docs/**',
      'public/**',
      'tests/**',
      'audits/__tests__/**',
      '.stryker-tmp/**',
      'reports/**',
      '**/*.d.ts'
    ]
  },
  ...createBaseConfig({tsconfigRootDir: import.meta.dirname}),
  {
    // Build/config scripts are plain JS (.mjs/.cjs/.js) and are not part of the
    // typed project graph. Turn off type-aware linting for them (disableTypeChecked
    // also turns off the project service, which would otherwise fail to resolve
    // them, e.g. .puppeteerrc.cjs).
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked
  },
  {
    // Node globals for the same build/config scripts (process, console, Buffer,
    // fetch, ...). Separate object so it merges with disableTypeChecked above
    // rather than replacing its parserOptions.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {globals: {...globals.node}}
  }
]
