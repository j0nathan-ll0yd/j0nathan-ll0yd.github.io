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
# ANONYMOUS volume. Without it, the container's install writes Linux-platform
# native packages (@rollup/rollup-linux-*, dprint, esbuild, sharp) straight into
# the bind-mounted HOST node_modules, clobbering the macOS arm64 darwin binaries.
# The host then fails `pnpm build` / dprint / git commit until a manual
# `pnpm install`. The anonymous volume gives the container its own node_modules
# layer, so the install never touches the host. The `@j0nathan-ll0yd/*` packages
# resolve from GitHub Packages (the forwarded GITHUB_TOKEN authenticates the
# registry read) into the container-private node_modules -- no host state is
# involved. `--rm` disposes the anonymous volume on exit, so each run does a fresh
# clean install exactly as before -- only the host is now spared.
# NOTE: the shadow volume mount MUST come AFTER the `/work` bind mount so it
# layers on top of it.
#
# `--store-dir /work/node_modules/.pnpm-store` is load-bearing for the SAME reason.
# pnpm puts its content-addressed store on the same filesystem as the project so it
# can hardlink into node_modules; left to itself it picks `<project>/.pnpm-store`,
# i.e. straight into the bind-mounted HOST repo -- ~700MB of blobs, some over
# GitHub's 100MB per-file limit, which a later `git add -A` will happily stage and
# the push will then be rejected for (observed 2026-08-12). Pointing it INSIDE the
# shadowed node_modules volume keeps it container-private and disposed by `--rm`,
# and keeps store and node_modules on one filesystem so hardlinking still works.
# .gitignore lists `.pnpm-store/` as the backstop.
#
# pnpm is provisioned in-container with `corepack` (bundled with the image's Node),
# which reads the exact `packageManager` pin from package.json -- so the container
# runs the same pnpm the host and CI do. COREPACK_ENABLE_DOWNLOAD_PROMPT=0 makes
# that first-run download non-interactive (it otherwise blocks on a y/N prompt
# with no TTY).
#
# Forward GITHUB_TOKEN so the container's install can authenticate to GitHub
# Packages for the @j0nathan-ll0yd/* scope (the six DS/LP packages + config).
# GitHub Packages requires a token even to read public packages. Unlike npm, pnpm
# does NOT expand ${GITHUB_TOKEN} from a committed project .npmrc (atlas decision
# 0032 removed that line), so the token is written to the container's USER-level
# npmrc with `pnpm config set` before installing -- the same wiring every workflow
# uses. Export it before running
# (e.g. `GITHUB_TOKEN=$(gh auth token) pnpm run test:visual`).
# Unset -> `pnpm config set` writes an empty value and the install 401s, exactly
# as it did before under npm.
docker run --rm --ipc=host --platform linux/arm64 \
  -e CI=true \
  -e GITHUB_TOKEN \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -v "$(pwd):/work" \
  -v /work/node_modules \
  -w /work \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  /bin/bash -c "corepack enable pnpm \
    && corepack pnpm --version \
    && corepack pnpm config set '//npm.pkg.github.com/:_authToken' \"\${GITHUB_TOKEN:-}\" \
    && corepack pnpm install --frozen-lockfile --store-dir /work/node_modules/.pnpm-store \
    && corepack pnpm exec playwright test --config=${CONFIG} $*"
