#!/usr/bin/env bash
# Fetches JSON Schema files from the backend repo for CI builds.
# Local dev doesn't need this — generate-types.mjs reads directly from the adjacent repo.
set -euo pipefail

REPO="j0nathan-ll0yd/mantle-Lifegames-Portal"
BRANCH="main"
BASE_URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/schemas"

SCHEMAS=(
  "health-export.schema.json"
  "sleep-export.schema.json"
  "workouts-export.schema.json"
  "books-export.schema.json"
  "github-events-export.schema.json"
  "github-starred-repos-export.schema.json"
  "articles-export.schema.json"
)

DEST="$(dirname "$0")/../schemas"
mkdir -p "$DEST"

echo "Fetching schemas from ${REPO}@${BRANCH}..."
for schema in "${SCHEMAS[@]}"; do
  echo "  ${schema}"
  curl -fsSL "${BASE_URL}/${schema}" -o "${DEST}/${schema}"
done

echo "Done. Schemas saved to ${DEST}/"
