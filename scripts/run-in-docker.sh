#!/usr/bin/env bash
# Apple Silicon runs via Rosetta (2-4x slower); --platform linux/amd64 explicit; requires Docker Desktop
set -euo pipefail

CONFIG="${1:?config path required (e.g. playwright.config.ts)}"
shift

VERSION=$(./scripts/playwright-version.sh)

docker run --rm --ipc=host --platform linux/amd64 \
  -v "$(pwd):/work" -w /work \
  -e USE_FIXTURES=true \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  /bin/bash -c "npm ci --legacy-peer-deps && npx playwright test --config=${CONFIG} $*"
