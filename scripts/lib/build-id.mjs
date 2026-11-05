import {COMPOSER_CONTRACT, composerAssetPath} from '../../src/lib/composed/paths.ts'

// The build id (atlas decision 0160, PR B). One source for every place that names the build:
// version.json (scripts/write-version.mjs), the Worker's own id (astro.config.mjs define
// __SSR_BUILD_ID__), and the composer's id and asset path (scripts/build-composer.mjs). The Worker
// serves a composed page only when the artifact's composer build equals its own, so two derivations
// that disagree would refuse every artifact.

/** Characters a build id may hold: it names a public asset (`/_ssr/composer-<build>.mjs`). */
const BUILD_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/** The commit this build is made from, or `dev` for a local build. */
export function buildId(env = process.env) {
  const id = env.GITHUB_SHA || 'dev'
  if (!BUILD_ID_PATTERN.test(id)) {
    throw new Error(`build id ${JSON.stringify(id)} is not a safe asset name`)
  }
  return id
}

/** The public path of this build's composer (src/lib/composed/paths.ts). */
export function composerPath(id = buildId()) {
  return composerAssetPath(id)
}

export { COMPOSER_CONTRACT }
