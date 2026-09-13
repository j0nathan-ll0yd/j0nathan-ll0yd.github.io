#!/usr/bin/env bash
# Runs the visual/drift Playwright suites inside the canonical Playwright noble
# image so locally-rendered PNGs match CI byte-for-byte.
#
# Parity model (post-arm64 migration, 2026-06-12):
#   - Self-hosted CI runs `runner-playwright` (ci-runners-private/images/), which
#     is `FROM mcr.microsoft.com/playwright:v${VERSION}-noble` for linux/arm64.
#   - This script pulls the SAME upstream tag and runs it natively under
#     Docker Desktop's Apple Virtualization Framework (no QEMU emulation,
#     no SwiftShader-on-QEMU SIGSEGV).
#   - Result: identical userspace + identical arch -> baseline PNGs produced
#     here will match CI bytes, which is the load-bearing property the
#     pre-push hook depends on.
#
# Keep `scripts/playwright-version.sh` and the Dockerfile FROM tag in
# `ci-runners-private/images/runner-playwright/Dockerfile` in lockstep with
# `@playwright/test` in pnpm-lock.yaml.
set -euo pipefail

CONFIG="${1:?config path required (e.g. playwright.config.ts)}"
shift

VERSION=$(./scripts/playwright-version.sh)

# The container writes $GITHUB_TOKEN into its npmrc as the npm.pkg.github.com
# authToken (below). `-e GITHUB_TOKEN` forwards whatever the host has -- and in
# gh-credential-helper setups that is EMPTY, so the container config carried an
# empty token and every @j0nathan-ll0yd/* install died with "config present, no
# auth header" (the FT4 push blocker, PR #272). Resolve a real token up front:
# use the exported GITHUB_TOKEN when present, fall back to the gh CLI keyring,
# and otherwise fail fast while the message can still name the fix.
GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: no GitHub token available for GitHub Packages auth inside the container." >&2
  echo "Supply one of:" >&2
  echo "  * export GITHUB_TOKEN=<token with read:packages>" >&2
  echo "  * gh auth login   (this script falls back to 'gh auth token')" >&2
  exit 1
fi
export GITHUB_TOKEN

# Pin arm64 to avoid cached amd64/QEMU browser crashes, and set CI so retries and workers match
# the hosted run. The node_modules shadow volume prevents Linux native packages from overwriting
# the host's macOS install; keep it after the /work bind. Put pnpm's store inside that volume too,
# or hundreds of megabytes land in the bind-mounted repository.
#
# Corepack follows package.json's exact pnpm pin. GITHUB_TOKEN is written to the container user
# npmrc because pnpm does not expand it from the committed project config.
#
# A11Y_UPDATE_BASELINE is forwarded so `pnpm run a11y:update-baseline` regenerates the per-widget
# a11y ratchet baseline (tests/behavioral/a11y-baseline.json) from a CI-parity run. Regenerating it
# on the host would record whatever the host browser happened to compute, which is the same
# parity trap the visual baselines have.
#
# dist/ gets its own shadow volume for the same reason node_modules does, but the
# failure it prevents is louder. Rolldown creates its output-chunk directories
# with a plain mkdir; on the macOS bind mount that call reports EEXIST for a
# directory the same build just made, and `astro build` dies with
#   Could not create directory for output chunks: /work/dist/.prerender
#   Caused by: File exists (os error 17)
# before a single test runs. Native Linux CI never sees it (no bind mount), so
# the breakage is local-only -- which is worse, because it takes out the only
# sanctioned path for regenerating baselines. Keeping dist off the bind mount
# fixes it outright. The host does not need the container's dist: baselines and
# test-results are written under tests/, which stays bind-mounted.
docker run --rm --ipc=host --platform linux/arm64 \
  -e CI=true \
  -e GITHUB_TOKEN \
  -e A11Y_UPDATE_BASELINE \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -v "$(pwd):/work" \
  -v /work/node_modules \
  -v /work/dist \
  -w /work \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  /bin/bash -c "corepack enable pnpm \
    && corepack pnpm --version \
    && corepack pnpm config set '//npm.pkg.github.com/:_authToken' \"\${GITHUB_TOKEN:-}\" \
    && corepack pnpm install --frozen-lockfile --store-dir /work/node_modules/.pnpm-store \
    && corepack pnpm exec playwright test --config=${CONFIG} $*"
