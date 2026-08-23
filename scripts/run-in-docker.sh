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

# Pin arm64 to avoid cached amd64/QEMU browser crashes, and set CI so retries and workers match
# the hosted run. The node_modules shadow volume prevents Linux native packages from overwriting
# the host's macOS install; keep it after the /work bind. Put pnpm's store inside that volume too,
# or hundreds of megabytes land in the bind-mounted repository.
#
# Corepack follows package.json's exact pnpm pin. GITHUB_TOKEN is written to the container user
# npmrc because pnpm does not expand it from the committed project config.
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
