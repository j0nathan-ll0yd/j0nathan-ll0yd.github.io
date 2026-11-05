#!/usr/bin/env sh
# Decides whether `.husky/pre-push` runs the Docker visual suite (atlas decision 0168 item 16).
#
# `visual-gate` is a required context, so CI binds the pixel gate. The hook runs the suite only
# when a pushed commit's diff against origin/main touches a rendered input (owner's choice).
#
# Input: git's pre-push stdin, one `<local ref> <local sha> <remote ref> <remote sha>` line per
# pushed ref. Empty input (a manual run) judges HEAD.
# Exit 0: run the suite. Exit 1: skip it. Either way, one reason line goes to stdout.
#
# Fails closed: a detached HEAD, a missing origin/main, or a diff git cannot compute exits 0.
# Only a computed diff that names no rendered input skips.
#
# `tests/unit/visual-scope.test.ts` drives each path against a scratch repository.

# The owner's list (src/ to playwright.config.ts), plus the inputs the visual suite also reads:
# scripts/ (the build, the composer and the Docker image pin), tests/data-plane/ (the fixture data
# plane behind the server render), tests/shared/ (the Chromium launch flags), tests/fixtures/
# (the published-read seam files), and the Worker, TypeScript and pnpm workspace configs.
RENDERED_INPUTS='src/ public/ tests/visual/ package.json pnpm-lock.yaml astro.config.mjs playwright.config.ts scripts/ tests/data-plane/ tests/shared/ tests/fixtures/ wrangler.jsonc tsconfig.json pnpm-workspace.yaml'
ZERO_SHA=0000000000000000000000000000000000000000

if ! git symbolic-ref -q HEAD >/dev/null 2>&1; then
  echo "HEAD is detached, so the diff against origin/main is not computed"
  exit 0
fi

if ! git rev-parse -q --verify refs/remotes/origin/main >/dev/null 2>&1; then
  echo "origin/main is missing, so the diff cannot be computed"
  exit 0
fi

refs=0
shas=''
while read -r _local_ref local_sha _rest; do
  [ -n "$local_sha" ] || continue
  refs=$((refs + 1))
  # A deleted ref pushes no commit.
  [ "$local_sha" = "$ZERO_SHA" ] || shas="$shas $local_sha"
done

if [ "$refs" -eq 0 ]; then
  if ! shas=$(git rev-parse -q --verify HEAD 2>/dev/null); then
    echo "HEAD does not resolve to a commit"
    exit 0
  fi
elif [ -z "$shas" ]; then
  echo "the push deletes refs only and carries no commit"
  exit 1
fi

for sha in $shas; do
  # Three dots: the diff from the merge base, so commits that reached main after the branch
  # point never count as this branch's change. The pathspecs stay unquoted on purpose.
  # shellcheck disable=SC2086
  if ! changed=$(git diff --name-only "origin/main...$sha" -- $RENDERED_INPUTS 2>/dev/null); then
    echo "git cannot diff $sha against origin/main"
    exit 0
  fi
  if [ -n "$changed" ]; then
    count=$(printf '%s\n' "$changed" | wc -l | tr -d ' ')
    first=$(printf '%s\n' "$changed" | head -n 1)
    echo "$sha changes $count rendered input(s), first $first"
    exit 0
  fi
done

echo "no pushed commit changes a rendered input ($RENDERED_INPUTS)"
exit 1
