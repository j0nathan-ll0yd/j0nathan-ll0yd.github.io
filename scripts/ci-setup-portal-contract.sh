#!/usr/bin/env bash
# Publishes @lifegames/portal-contract to the LOCAL yalc store for CI.
#
# @lifegames/portal-contract is produced by the backend repo
# (mantle-LifegamesPortal/packages/portal-contract). This web repo depends on it
# directly (file:.yalc/@lifegames/portal-contract), AND the design-system clone
# that ci-setup.sh builds also depends on it. Because `.yalc/` is gitignored,
# CI must publish it to the local yalc store before either consumer installs.
#
# This script ONLY clones the backend and yalc-publishes portal-contract; the
# caller (ci-setup.sh) is responsible for `npx yalc add`-ing it into the right
# consumers (the DS clone's sub-packages and this web repo) at the right time.
#
# Override via env:
#   LP_REPO        — git URL  (default: HTTPS to j0nathan-ll0yd/mantle-LifegamesPortal)
#   LP_DIR         — clone dir (default: /tmp/mantle-LifegamesPortal)
#   LP_REF         — branch/tag/sha (default: main)
#   LP_REPO_TOKEN  — fine-grained PAT (Contents:Read on the PRIVATE backend repo).
#                    When set, it is injected into the HTTPS clone URL so CI on
#                    self-hosted runners (no cross-repo git creds) can clone the
#                    private backend. Left unset for local/no-token dev so the
#                    plain HTTPS/SSH/local-path URL still works.

set -euo pipefail

LP_REPO="${LP_REPO:-https://github.com/j0nathan-ll0yd/mantle-LifegamesPortal.git}"
LP_DIR="${LP_DIR:-/tmp/mantle-LifegamesPortal}"
LP_REF="${LP_REF:-main}"

# Inject the PAT into the HTTPS clone URL when provided (private-repo CI clone).
# Keep the plain URL otherwise so local/no-token runs are unaffected.
if [ -n "${LP_REPO_TOKEN:-}" ]; then
  case "$LP_REPO" in
    https://github.com/*) LP_REPO="https://x-access-token:${LP_REPO_TOKEN}@github.com/${LP_REPO#https://github.com/}" ;;
  esac
fi

# Do NOT echo $LP_REPO — it may embed $LP_REPO_TOKEN after injection above.
echo "[ci-setup-pc] LP_DIR=$LP_DIR"
echo "[ci-setup-pc] LP_REF=$LP_REF"

if [ -d "$LP_DIR/.git" ]; then
  echo "[ci-setup-pc] Updating existing backend clone..."
  git -C "$LP_DIR" fetch origin "$LP_REF" --depth 1
  git -C "$LP_DIR" checkout FETCH_HEAD
else
  echo "[ci-setup-pc] Cloning backend (depth 1, ref $LP_REF)..."
  git clone --depth 1 --branch "$LP_REF" "$LP_REPO" "$LP_DIR"
fi

if command -v corepack >/dev/null 2>&1; then
  corepack enable
fi

echo "[ci-setup-pc] Installing + yalc-publishing portal-contract..."
# prepublishOnly (codegen + tsc) needs docs/api/openapi.yaml + schemas/ from the
# backend checkout, plus portal-contract's own devDeps.
(cd "$LP_DIR/packages/portal-contract" && pnpm install && npx -y yalc publish)

echo "[ci-setup-pc] Done."
