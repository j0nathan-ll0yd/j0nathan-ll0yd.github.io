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
# `@playwright/test` in package-lock.json.
set -euo pipefail

CONFIG="${1:?config path required (e.g. playwright.config.ts)}"
shift

VERSION=$(./scripts/playwright-version.sh)

# --platform linux/arm64 is explicit (not redundant). The upstream Playwright
# image is a multi-arch manifest list; without an explicit platform, Docker
# Desktop on Apple Silicon may still pick the amd64 entry (depending on
# DOCKER_DEFAULT_PLATFORM, buildx settings, or a previously-pulled tag cached
# under amd64), which would re-introduce the QEMU SwiftShader SIGSEGV that
# this whole migration is here to eliminate.
# CI=true makes the in-container run mirror CI exactly (playwright.config.ts gates
# retries/workers/forbidOnly/reporter/reuseExistingServer on `process.env.CI`).
# Without it the local gate ran with retries:0 while CI uses retries:1, so a
# transient Chromium worker-launch crash under fullyParallel load (seen on the
# tall full-page dashboard captures) fails the pre-push hook where CI would retry
# and pass. Real pixel diffs still fail every retry, so this never masks them.
#
# `-v /work/node_modules` shadows the repo's node_modules with a container-private
# ANONYMOUS volume. Without it, the container's `npm ci` writes Linux-platform
# native packages (@rollup/rollup-linux-*, dprint, esbuild, sharp) straight into
# the bind-mounted HOST node_modules, clobbering the macOS arm64 darwin binaries.
# The host then fails `npm run build` / dprint / git commit until a manual
# `npm ci`. The anonymous volume gives the container its own node_modules layer,
# so the install never touches the host. `.yalc/@lifegames/*` still resolves:
# it lives under the `/work` bind mount, so `npm ci` re-creates the file:
# symlinks inside the container-private node_modules pointing at the real
# .yalc sources. `--rm` disposes the anonymous volume on exit, so each run
# does a fresh clean install exactly as before -- only the host is now spared.
# NOTE: the shadow volume mount MUST come AFTER the `/work` bind mount so it
# layers on top of it.
# Forward GITHUB_TOKEN so the container's `npm ci` can authenticate to GitHub
# Packages for @j0nathan-ll0yd/config (private registry, added in #142). The
# repo .npmrc sets //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}; without the
# env var it expands to empty and the install 401s. Export it before running
# (e.g. `GITHUB_TOKEN=$(gh auth token) npm run test:visual`). Unset -> no-op.
docker run --rm --ipc=host --platform linux/arm64 \
  -e CI=true \
  -e GITHUB_TOKEN \
  -v "$(pwd):/work" \
  -v /work/node_modules \
  -w /work \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  /bin/bash -c "npm ci --legacy-peer-deps && npx playwright test --config=${CONFIG} $*"
