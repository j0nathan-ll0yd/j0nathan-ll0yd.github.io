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
docker run --rm --ipc=host --platform linux/arm64 \
  -e CI=true \
  -v "$(pwd):/work" -w /work \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  /bin/bash -c "npm ci --legacy-peer-deps && npx playwright test --config=${CONFIG} $*"
