# CLAUDE.md -- Human Datastream Portfolio

@AGENTS.md

The shared, cross-tool contract lives in `AGENTS.md` (imported above). This file
adds only Claude Code-specific signal. Do not duplicate AGENTS.md content here --
new conventions and facts land in `AGENTS.md` by default.

## Claude-Specific Extras

### OMC delegation

This repo runs under oh-my-claudecode. Delegate multi-file changes, refactors,
debugging, reviews, and verification to the appropriate agent (`executor` for
code, `code-reviewer`/`verifier` for approval passes). Work directly only for
trivial ops. Keep authoring and review in separate passes -- never self-approve
in the same context.

### MCP / tooling

No project-specific MCP servers are required for this repo. Use the LSP and
AST tools for code intelligence when editing TypeScript/Astro sources.

### Skills triggers

No repo-local skills. Cross-cutting type propagation (when backend Zod schemas
change) is driven from the monorepo hub via `/sync-types`; widget/design changes
originate in `design-system-Lifegames`, not here.

### Commit protocol

Conventional-commit subject lines. Plain ASCII only -- no Unicode arrows or
em-dashes. No AI attribution (`Co-Authored-By: Claude`, etc.). Add git trailers
(`Constraint:`, `Rejected:`, `Directive:`, `Confidence:`, `Scope-risk:`) per the
global commit protocol when a change carries non-trivial decision context.

## Deeper Reference

- `docs/wiki/` -- architecture, brand guide, LLM-content spec.
- `docs/onboarding-review/` -- active architectural plans and roadmap.
