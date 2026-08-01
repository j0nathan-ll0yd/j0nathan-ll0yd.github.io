#!/usr/bin/env bash
# Phase 2 CI install step. Replaces the default `npm ci --legacy-peer-deps`.
# Clones design-system-Lifegames, builds its packages, yalc-publishes the DS
# packages (tokens, web, schemas, copy, fixtures), pulls them into this repo's
# .yalc/ alongside portal-contract, and then runs npm ci so the file:.yalc/*
# deps in package.json resolve.
#
# Package names are DERIVED from each cloned source repo's package.json, never
# hardcoded: yalc keys its store by package name, and the yalc retirement
# (atlas#1) is renaming these packages @lifegames/* -> @j0nathan-ll0yd/* on a
# per-repo schedule. Deriving is correct before, after, and between renames.
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

# Mirror ci-setup-portal-contract.sh's LP clone dir so we can read the backend's
# real package name off disk after it clones. Same default + override contract.
LP_DIR="${LP_DIR:-/tmp/mantle-LifegamesPortal}"

echo "[ci-setup] DS_REPO=$DS_REPO"
echo "[ci-setup] DS_DIR=$DS_DIR"
echo "[ci-setup] DS_REF=$DS_REF"

# Publish portal-contract to the local yalc store FIRST. Both this web repo and
# the DS clone (built below) depend on it; it must exist in the store before
# either runs `pnpm install` / `npm ci`.
echo "[ci-setup] Publishing portal-contract (backend producer)..."
bash "$SCRIPT_DIR/ci-setup-portal-contract.sh"

# Derive the backend package name from the cloned source, never hardcode it.
# yalc keys its store by package name; the backend renamed portal-contract
# during the yalc retirement (atlas#1), so the literal name is not stable.
# Reading it off the clone is correct before, after, and across future renames.
PC_PKG="$(node -p "require('$LP_DIR/packages/portal-contract/package.json').name")"
echo "[ci-setup] portal-contract package name: $PC_PKG"

# Remove a stale non-repo $DS_DIR (leftover from an aborted run) before cloning,
# so `git clone` never aborts with "destination path already exists and is not an
# empty directory" (atlas 0013, Task 2 #2 -- same failure mode as the LP clone).
if [ -d "$DS_DIR" ] && [ ! -d "$DS_DIR/.git" ]; then
  echo "[ci-setup] $DS_DIR exists but is not a git repo; removing stale dir."
  rm -rf "$DS_DIR"
fi

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

# Restore portal-contract into the DS clone's consuming sub-packages BEFORE its
# `pnpm install --frozen-lockfile`. The DS lockfile pins each of these to its own
# .yalc/<portal-contract>; yalc add is idempotent on package.json (the file: dep
# is already declared under the derived name), so --frozen-lockfile holds.
echo "[ci-setup] yalc add $PC_PKG into DS sub-packages..."
for ds_consumer in packages/web packages/schemas packages/fixtures apps/portfolio; do
  (cd "$DS_DIR/$ds_consumer" && npx -y yalc add "$PC_PKG")
done

(cd "$DS_DIR" && pnpm install --frozen-lockfile)

echo "[ci-setup] Building DS packages (tokens + web + schemas)..."
(cd "$DS_DIR" && pnpm build)

echo "[ci-setup] yalc:publish from DS..."
(cd "$DS_DIR" && pnpm yalc:publish)

# Derive the five DS package names from the cloned DS source too. DS #151
# (yalc retirement) renames these @lifegames/* -> @j0nathan-ll0yd/*; reading
# them off the clone tracks whichever names DS main currently publishes.
DS_PKGS=()
for ds_pkg in tokens web schemas copy fixtures; do
  DS_PKGS+=("$(node -p "require('$DS_DIR/packages/$ds_pkg/package.json').name")")
done
echo "[ci-setup] DS package names: ${DS_PKGS[*]}"

echo "[ci-setup] yalc add into consumer..."
npx yalc add "$PC_PKG" "${DS_PKGS[@]}"

echo "[ci-setup] npm ci --legacy-peer-deps..."
npm ci --legacy-peer-deps

echo "[ci-setup] Done."
