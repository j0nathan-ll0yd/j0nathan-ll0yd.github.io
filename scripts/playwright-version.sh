#!/usr/bin/env bash
set -euo pipefail

# Resolve the @playwright/test version the LOCKFILE pins, so the Docker image tag
# matches what `pnpm install --frozen-lockfile` will actually install inside the
# container (scripts/run-in-docker.sh) -- that lockstep is what makes local PNG
# bytes match CI. Reads pnpm-lock.yaml (not node_modules) so it is correct even
# before an install.
#
# The 6-space anchor pins this to the `importers: -> . -> devDependencies:` block;
# the `packages:`/`snapshots:` sections list `'@playwright/test@<v>':` keys at a
# 2-space indent and must not match.
node -e "
const {readFileSync} = require('node:fs')
const lock = readFileSync('./pnpm-lock.yaml', 'utf-8')
const m = lock.match(/^      '@playwright\/test':\n        specifier: .*\n        version: (\S+)\$/m)
if (!m) {
  console.error('[playwright-version] Could not read @playwright/test from pnpm-lock.yaml.')
  process.exit(1)
}
process.stdout.write(m[1])
"
