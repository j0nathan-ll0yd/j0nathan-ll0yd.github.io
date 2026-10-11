import {createBaseConfig} from '@j0nathan-ll0yd/config/eslint'
import * as espree from 'espree'
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
      // public/ holds raw-served assets. Only public/js (first-party scripts) is linted
      // for its ES2017 syntax floor; vendored libraries stay out.
      'public/*',
      '!public/js/',
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
    ignores: ['public/js/**'],
    languageOptions: {globals: {...globals.node}}
  },
  {
    // Raw-served scripts (public/js/*.js) skip the bundler, so the browser parses
    // them as written. ecmaVersion 2017 turns any later syntax (?., ??, object
    // spread, class fields, top-level await) into a parse error. This is the
    // floor AGENTS.md and widget check W9 state. The parser is espree on purpose:
    // the typescript-eslint parser accepts every syntax and ignores ecmaVersion. sourceType 'script' because they
    // load as classic scripts. tests/unit/public-js-floor.test.ts pins this block.
    files: ['public/js/**/*.js'],
    ignores: ['public/js/sw-purge.js'],
    languageOptions: {
      parser: espree,
      ecmaVersion: 2017,
      sourceType: 'script',
      // sa_event is the Simple Analytics global that public/js/sa-stub.js and the proxied /sa script define on window.
      globals: {...globals.browser, sa_event: 'readonly'}
    },
    // The gate here is syntax plus undefined names. Style rules stay off so lint never
    // forces a runtime edit to the service-worker and focus scripts: they use
    // best-effort empty catch blocks and var re-declarations on purpose, and an
    // unused catch binding cannot be dropped below ES2019.
    rules: {'@typescript-eslint/no-unused-vars': 'off', 'no-unused-vars': 'off', 'no-empty': 'off', 'no-redeclare': 'off'}
  },
  {
    // sw-purge.js is loaded into the Workbox service worker by importScripts, so it
    // runs in the service-worker global scope, not a page.
    files: ['public/js/sw-purge.js'],
    languageOptions: {parser: espree, ecmaVersion: 2017, sourceType: 'script', globals: {...globals.serviceworker}},
    rules: {'@typescript-eslint/no-unused-vars': 'off', 'no-unused-vars': 'off', 'no-empty': 'off', 'no-redeclare': 'off'}
  }
]
