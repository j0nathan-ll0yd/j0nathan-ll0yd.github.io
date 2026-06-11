#!/usr/bin/env bash
# Phase 2 CI install step. Replaces the default `npm ci --legacy-peer-deps`.
# Clones design-system-Lifegames, builds its packages, yalc-publishes the
# three @lifegames/* packages, pulls them into this repo's .yalc/, and then
# runs npm ci so the file:.yalc/* deps in package.json resolve.
#
# Override via env:
#   DS_REPO  — git URL  (default: HTTPS to j0nathan-ll0yd/design-system-Lifegames)
#   DS_DIR   — clone dir (default: /tmp/design-system-Lifegames)
#   DS_REF   — branch/tag/sha (default: main; pin in CF Pages env for prod stability)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DS_REPO="${DS_REPO:-https://github.com/j0nathan-ll0yd/design-system-Lifegames.git}"
DS_DIR="${DS_DIR:-/tmp/design-system-Lifegames}"
DS_REF="${DS_REF:-main}"

echo "[ci-setup] DS_REPO=$DS_REPO"
echo "[ci-setup] DS_DIR=$DS_DIR"
echo "[ci-setup] DS_REF=$DS_REF"

# Publish @lifegames/portal-contract to the local yalc store FIRST. Both this
# web repo and the DS clone (built below) depend on it; it must exist in the
# store before either runs `pnpm install` / `npm ci`.
echo "[ci-setup] Publishing @lifegames/portal-contract (backend producer)..."
bash "$SCRIPT_DIR/ci-setup-portal-contract.sh"

if [ -d "$DS_DIR/.git" ]; then
  echo "[ci-setup] Updating existing DS clone..."
  git -C "$DS_DIR" fetch origin "$DS_REF" --depth 1
  git -C "$DS_DIR" checkout FETCH_HEAD
else
  echo "[ci-setup] Cloning DS (depth 1, ref $DS_REF)..."
  git clone --depth 1 --branch "$DS_REF" "$DS_REPO" "$DS_DIR"
fi

echo "[ci-setup] Installing DS deps (corepack if available, else system pnpm)..."
if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi

# Restore @lifegames/portal-contract into the DS clone's consuming sub-packages
# BEFORE its `pnpm install --frozen-lockfile`. The DS lockfile pins each of
# these to its own .yalc/@lifegames/portal-contract; yalc add is idempotent on
# package.json (the file: dep is already declared), so --frozen-lockfile holds.
echo "[ci-setup] yalc add portal-contract into DS sub-packages..."
for ds_consumer in packages/web packages/schemas apps/portfolio; do
  (cd "$DS_DIR/$ds_consumer" && npx -y yalc add @lifegames/portal-contract)
done

(cd "$DS_DIR" && pnpm install --frozen-lockfile)

echo "[ci-setup] Building DS packages (tokens + web + schemas)..."
(cd "$DS_DIR" && pnpm build)

echo "[ci-setup] yalc:publish from DS..."
(cd "$DS_DIR" && pnpm yalc:publish)

echo "[ci-setup] yalc add into consumer..."
npx yalc add @lifegames/portal-contract @lifegames/tokens @lifegames/web @lifegames/schemas

echo "[ci-setup] npm ci --legacy-peer-deps..."
npm ci --legacy-peer-deps

echo "[ci-setup] Done."
