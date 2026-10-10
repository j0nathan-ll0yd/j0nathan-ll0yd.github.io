// forbid-fixtures -- the production build guard against design-system fixtures
// (atlas decision 0160, plan Step 6.7).
//
// Production `/` must never carry fixture data (decision 0160, PR 0a). `@j0nathan-ll0yd/fixtures` is
// a devDependency for tests only. This Vite plugin fails `astro build` when ANY module in the build
// graph resolves to that package: a direct import from src/, or a transitive one through an
// intermediate module or another package.
//
// What it watches: the production module graph, at build time, in every Vite environment Astro
// builds (client and prerender server). scripts/audit-fixtures.mjs sees only the files under src/
// and the retired fixture directories; it cannot see an import that arrives through another module
// or package. This plugin is the only check that sees a transitive import before it ships.
//
// How it sees all of it:
//   - resolveId catches the bare specifier (`@j0nathan-ll0yd/fixtures` or any subpath) from any
//     importer Vite processes;
//   - load catches any module whose resolved file sits inside the fixtures package, however the
//     import was spelled (a relative path inside another package, a symlinked store path);
//   - the server build normally externalizes node_modules, and Vite never reads an external
//     package's own imports. The plugin therefore bundles every first-party `@j0nathan-ll0yd/*`
//     package in every environment (`resolve.noExternal`), so a first-party package that
//     imports fixtures is read, not skipped. A third-party package stays external; none in the
//     tree depends on fixtures (`pnpm why @j0nathan-ll0yd/fixtures` names only this repo).
//
// The Pages Functions under functions/ are bundled by wrangler, outside this build. The same
// plugin runs over their graph in tests/unit/forbid-fixtures.test.ts.
//
// Its self-test is tests/unit/forbid-fixtures.test.ts: it builds a temporary entry that imports
// fixtures through an intermediate module, and through an intermediate first-party package, in
// both a client and a server build, and asserts that every build fails.

export const FIXTURES_PACKAGE = '@j0nathan-ll0yd/fixtures'
export const FIRST_PARTY_SCOPE = /^@j0nathan-ll0yd\//

/** True when an import specifier names the fixtures package or one of its subpaths. */
export function isFixturesSpecifier(source) {
  return source === FIXTURES_PACKAGE || source.startsWith(FIXTURES_PACKAGE + '/')
}

/** True when a resolved module id is a file inside the fixtures package (npm, pnpm store or link). */
export function isFixturesModule(id) {
  const path = id.replace(/\\/g, '/').split('?')[0]
  return path.includes('/node_modules/' + FIXTURES_PACKAGE + '/') || path.includes('/@j0nathan-ll0yd+fixtures@')
}

function failure(what, importer) {
  return 'forbid-fixtures: the production build reached ' +
    FIXTURES_PACKAGE +
    ' (' +
    what +
    ')' +
    (importer ? ', imported by ' + importer : '') +
    '. Production pages carry no fixture data (atlas decision 0160). Fixtures are for tests only:' +
    ' serve them by Playwright route interception, never through a module the build reaches.'
}

/** The Vite plugin. Applies to `vite build` only; the dev server and the test runners are unaffected. */
export function forbidFixtures() {
  return {
    name: 'forbid-fixtures',
    apply: 'build',
    enforce: 'pre',
    // Every environment: Astro builds `client` and `prerender` (and `ssr` with an adapter). A
    // client build bundles everything already; a server build would externalize the scope.
    configEnvironment(_name, options) {
      if (options.resolve?.noExternal === true) {
        return null
      }
      return {resolve: {noExternal: [FIRST_PARTY_SCOPE]}}
    },
    resolveId(source, importer) {
      if (isFixturesSpecifier(source)) {
        this.error(failure(source, importer))
      }
      return null
    },
    load(id) {
      if (isFixturesModule(id)) {
        this.error(failure(id))
      }
      return null
    }
  }
}
