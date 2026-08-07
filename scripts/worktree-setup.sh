#!/usr/bin/env sh
set -e

echo "Setting up new worktree..."

COMMON_DIR=$(git rev-parse --git-common-dir)
# Handle case where COMMON_DIR is just .git (in main worktree itself, though this shouldn't run there)
if [ "$COMMON_DIR" = ".git" ]; then
    MAIN_WT=$(git rev-parse --show-toplevel)
else
    # COMMON_DIR is usually an absolute path ending in .git
    MAIN_WT=$(dirname "$COMMON_DIR")
fi

if [ -f "$MAIN_WT/.env.local" ]; then
    echo "Copying .env.local from main worktree..."
    cp "$MAIN_WT/.env.local" .env.local
fi

if [ -d "$MAIN_WT/.claude/rules" ]; then
    echo "Copying .claude/rules/ from main worktree..."
    mkdir -p .claude
    cp -r "$MAIN_WT/.claude/rules" .claude/
fi

if [ -f "package-lock.json" ] || [ -f "package.json" ]; then
    echo "Running npm ci..."
    npm ci
fi

if command -v direnv >/dev/null 2>&1; then
    echo "Allowing direnv..."
    direnv allow
fi

echo "Worktree setup complete."
