#!/usr/bin/env bash
# Runs the visual/drift Playwright suites inside the canonical amd64 Playwright
# image so locally-rendered PNGs match CI's Linux/amd64 bytes.
#
# Apple Silicon (arm64) CANNOT run this: the amd64 image executes Chromium under
# QEMU emulation, and the determinism flags use SwiftShader's x86 software-GL
# JIT (--use-gl=swiftshader / --enable-unsafe-swiftshader), which SIGSEGVs under
# QEMU at browser launch ("qemu: uncaught target signal 5" -> SIGSEGV). Every
# test then fails at newPage(). Regenerate/check baselines on native amd64 via
# the CI `update-snapshots` PR label instead (see .github/workflows/update-snapshots.yml).
set -euo pipefail

HOST_ARCH="$(uname -m)"
if [[ "${HOST_ARCH}" == "arm64" || "${HOST_ARCH}" == "aarch64" ]] && [[ "${FORCE_LOCAL_DOCKER_VISUAL:-}" != "1" ]]; then
  {
    echo "ERROR: Visual regression in Docker cannot run on Apple Silicon (${HOST_ARCH})."
    echo "       The amd64 Playwright image runs Chromium under QEMU emulation, and the"
    echo "       SwiftShader software-GL determinism flags SIGSEGV at browser launch, so"
    echo "       every test fails at newPage() with 'browser has been closed'."
    echo ""
    echo "  Fix: regenerate/check baselines on native amd64 via CI:"
    echo "       1. Push your branch and open a PR."
    echo "       2. Add the 'update-snapshots' label to regenerate baselines (auto-committed"
    echo "          back to the branch), or let visual-tests.yml check them. CI runs on"
    echo "          native amd64 -- no emulation, SwiftShader works."
    echo ""
    echo "  Override (known to crash on Apple Silicon): FORCE_LOCAL_DOCKER_VISUAL=1 $0 ..."
  } >&2
  exit 1
fi

CONFIG="${1:?config path required (e.g. playwright.config.ts)}"
shift

VERSION=$(./scripts/playwright-version.sh)

docker run --rm --ipc=host --platform linux/amd64 \
  -v "$(pwd):/work" -w /work \
  -e USE_FIXTURES=true \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  /bin/bash -c "npm ci --legacy-peer-deps && npx playwright test --config=${CONFIG} $*"
