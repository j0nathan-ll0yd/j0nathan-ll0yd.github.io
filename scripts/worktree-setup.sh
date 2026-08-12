#!/usr/bin/env sh
# Worktree provisioner — Decision 0005 + speed optimizations
set -u

worktree="$(git rev-parse --show-toplevel)"
main="$(dirname "$(git rev-parse --git-common-dir)")"

[ "$worktree" = "$main" ] && exit 0

log() { printf 'worktree-setup: %s\n' "$1"; }

# 1) Synchronous (< 100ms): Seed required gitignored config
for rel in .env.local .claude/rules; do
  src="$main/$rel"
  dst="$worktree/$rel"
  if [ -e "$src" ] && [ ! -e "$dst" ]; then
    mkdir -p "$(dirname "$dst")"
    cp -R "$src" "$dst" 2>/dev/null && log "seeded $rel"
  fi
done

# 2) Direnv auto-allow
if command -v direnv >/dev/null 2>&1 && [ -f "$worktree/.envrc" ]; then
  ( cd "$worktree" && direnv allow >/dev/null 2>&1 || true )
fi

# 3) Fast dependency install (non-blocking)
if [ "${WORKTREE_SKIP_INSTALL:-0}" != "1" ] && [ -f "$worktree/pnpm-lock.yaml" ]; then
  log "installing dependencies (pnpm install --frozen-lockfile)…"
  ( cd "$worktree" && pnpm install --frozen-lockfile >/dev/null 2>&1 ) &
fi

log "done (background tasks PID $!)"
