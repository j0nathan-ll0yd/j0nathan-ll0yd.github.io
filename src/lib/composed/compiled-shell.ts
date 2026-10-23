// The data-free page cut at build time and compiled into the Worker (atlas decision 0164, Variant D).
//
// scripts/build-shell.mjs writes ./shell.generated.ts from dist/client/index.html; `pnpm build` runs
// `astro build` twice around it (scripts/build-site.mjs), so the second Worker bundle compiles in the cut of its own build's
// page, and `build-shell.mjs --check` proves it. The module is gitignored: a
// fresh checkout, `astro dev`, the type check and the unit tests have none, and this glob then finds
// nothing. Without a compiled shell the Worker serves `/` the way it did before decision 0164.
import type {Shell} from './shell'

interface GeneratedShellModule {
  SHELL: Shell
  SHELL_BUILD: string
  SHELL_PAGE_SHA256: string
}

const found = import.meta.glob<GeneratedShellModule>('./shell.generated.ts', {eager: true})

/** The compiled shell and the build it was cut from, or null when this bundle has none. */
export const COMPILED_SHELL: {shell: Shell; build: string; sha256: string} | null = (() => {
  const generated = found['./shell.generated.ts']
  return generated === undefined ? null : {shell: generated.SHELL, build: generated.SHELL_BUILD, sha256: generated.SHELL_PAGE_SHA256}
})()
