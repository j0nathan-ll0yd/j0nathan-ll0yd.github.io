import {execSync} from 'child_process'

/**
 * The variables Vitest sets in its own process for `import.meta.env`. Measured in a globalSetup:
 * `TEST`, `VITEST`, `NODE_ENV=test`, `MODE=test`, `DEV=1`, `PROD=''`, `BASE_URL=/`. Vite reads
 * `DEV`, `PROD`, and `MODE` from the environment it inherits, so a build that inherits them
 * renders the `import.meta.env.DEV` branches and drops the `PROD` ones. A globalSetup sees the
 * environment only after Vitest has written these, so the filter is by name: a variable of the same
 * name set by the shell or CI is dropped too. None of these names configures this build.
 */
const VITEST_ENV = /^(TEST|VITEST.*|MODE|DEV|PROD|SSR|BASE_URL)$/

export async function setup() {
  // The build-output tests must inspect the bundle that deploys. Vitest runs with NODE_ENV=test,
  // and Vite derives import.meta.env.DEV from NODE_ENV, so an inherited value built a
  // dev-flavoured client bundle (live-data read `/api/live`, the dev proxy). Overriding NODE_ENV
  // alone was not enough: the inherited DEV, PROD, and MODE still built the dev-only
  // leaflet-lazy.js into every page and left out the production-only scripts.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !VITEST_ENV.test(name)))
  execSync('pnpm run build', {stdio: 'inherit', cwd: process.cwd(), env: {...env, NODE_ENV: 'production'}})
}
