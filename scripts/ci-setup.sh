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

DS_REPO="${DS_REPO:-https://github.com/j0nathan-ll0yd/design-system-Lifegames.git}"
DS_DIR="${DS_DIR:-/tmp/design-system-Lifegames}"
DS_REF="${DS_REF:-main}"

echo "[ci-setup] DS_REPO=$DS_REPO"
echo "[ci-setup] DS_DIR=$DS_DIR"
echo "[ci-setup] DS_REF=$DS_REF"

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
(cd "$DS_DIR" && pnpm install --frozen-lockfile)

echo "[ci-setup] Building DS packages (tokens + web + schemas)..."
(cd "$DS_DIR" && pnpm build)

echo "[ci-setup] yalc:publish from DS..."
(cd "$DS_DIR" && pnpm yalc:publish)

echo "[ci-setup] yalc add into consumer..."
npx yalc add @lifegames/tokens @lifegames/web @lifegames/schemas

echo "[ci-setup] npm ci --legacy-peer-deps..."
npm ci --legacy-peer-deps

echo "[ci-setup] Done."
