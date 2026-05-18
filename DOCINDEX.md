# Documentation Surface Index

**Created:** 2026-05-18
**Maintainer:** Contributors to `anomalyco/opencode`

This index tracks all documentation surfaces in the repository with ownership, entrypoints, and last-verified timestamps.

---

## Repository Governance

| Document | Owner | Entrypoint | Status | Last Verified |
|----------|-------|------------|--------|---------------|
| `README.md` | OpenCode team | Project landing page | production | 2026-05-18 |
| `AGENTS.md` | OpenCode team | Agent operational rules | production | 2026-05-18 |
| `GEMINI.md` | OpenCode team | AI assistant project overview | production | 2026-05-18 |
| `CONTRIBUTING.md` | OpenCode team | Contribution guide + policies | production | 2026-05-18 |
| `SECURITY.md` | OpenCode team | Security policy + scope | production | 2026-05-18 |
| `LICENSE` | OpenCode team | MIT license | production | 2026-05-18 |
| `index.md` | OpenCode team | Folder-based repository map | production | 2026-05-18 |
| `DOCINDEX.md` | OpenCode team | This file — documentation surface index | production | 2026-05-18 |
| `.github/PULL_REQUEST_TEMPLATE.md` | OpenCode team | PR template | production | 2026-05-18 |

---

## Technical Documentation (`docs/`)

| Document | Owner | Entrypoint | Status | Last Verified |
|----------|-------|------------|--------|---------------|
| `docs/README.md` | OpenCode team | Docs directory index | production | 2026-05-18 |
| `docs/ADID_Framework_15_3.md` | ADID team | Epistemic markers, semantic vectors, AGI Reasoning Kernel | production | 2026-05-18 |
| `docs/external-file-locations.md` | OpenCode team | All file paths opencode reads/writes outside worktree | production | 2026-05-18 |

---

## Architecture Specifications (`specs/`)

| Document | Owner | Entrypoint | Status | Last Verified |
|----------|-------|------------|--------|---------------|
| `specs/project.md` | OpenCode team | API spec for project/session management layer | production | 2026-05-18 |
| `specs/v2/session.md` | OpenCode team | v2 proposal: remove dedicated POST /session/:id/init | production | 2026-05-18 |

---

## Effect Migration Specs (`specs/effect/`)

| Document | Owner | Entrypoint | Status | Last Verified |
|----------|-------|------------|--------|---------------|
| `specs/effect/migration.md` | OpenCode team | Effect migration pattern reference | production | 2026-05-18 |
| `specs/effect/schema.md` | OpenCode team | Effect schema conventions | production | 2026-05-18 |
| `specs/effect/tools.md` | OpenCode team | Effect tool patterns | production | 2026-05-18 |
| `specs/effect/routes.md` | OpenCode team | Effect route patterns | production | 2026-05-18 |
| `specs/effect/http-api.md` | OpenCode team | HTTP API design | production | 2026-05-18 |
| `specs/effect/facades.md` | OpenCode team | Facade patterns | production | 2026-05-18 |
| `specs/effect/instance-context.md` | OpenCode team | Instance context pattern | production | 2026-05-18 |
| `specs/effect/loose-ends.md` | OpenCode team | Loose ends / known gaps | production | 2026-05-18 |
| `specs/effect/server-package.md` | OpenCode team | Server package design | production | 2026-05-18 |

---

## Upstream Comparison (`upstream_comparison/`)

| Document | Owner | Entrypoint | Status | Last Verified |
|----------|-------|------------|--------|---------------|
| `upstream_comparison/README.md` | OpenCode team | Fork point, divergence summary, adoptable patterns from upstream `dev` | production | 2026-05-18 |

---

## Plans (`plans/`)

| Document | Owner | Status | Last Verified |
|----------|-------|--------|---------------|
| `plans/bug-resolution-plan.md` | OpenCode team | active | 2026-05-18 |
| `plans/20260518_project_health_plan.md` | OpenCode team | active | 2026-05-18 |

---

## Completed Plans (`plans_completed/`)

| Document | Owner | Status | Last Verified |
|----------|-------|--------|---------------|
| `plans_completed/PERF_PLAN.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/unified-logging.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/per-project-db-remaining.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/security-hardening-and-cleanup.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/bun-shell-migration.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/external-file-locations-redesign.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/per-edit-backups.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/session-delete-rename-fix.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/silent-catch-elimination.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/log-system-optimization.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/log-dedup.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/fix-global-paths-worktree-relative.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/remove-migrations-inline-schema.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/remove-protocol-overrides.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/deepseek-v4-features.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/fix-web-bundle-log-dependency.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/unified-task-model.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/backport-perf-hotfixes.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/perf-fixes.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/perf-fixes-2.md` | OpenCode team | completed | 2026-05-18 |
| `plans_completed/bug-fixes-round-1.md` | OpenCode team | completed | 2026-05-18 |

---

## Research (`research/`)

| Document | Owner | Status | Last Verified |
|----------|-------|--------|---------------|
| `research/research_v1.md` | OpenCode team | reference | 2026-05-18 |
| `research/research_v2.md` | OpenCode team | reference | 2026-05-18 |
| `research/research_v3.md` | OpenCode team | reference | 2026-05-18 |

---

## CI/CD Workflows (`.github/workflows/`)

28 workflow files covering: typecheck, test (unit+e2e), publish, deploy, containers, PR/issue triage, docs, Nix, AI agent, stats. See `index.md` for the folder map.

---

## Verification

Run `adm --verify-all docs specs` for clean report on documentation integrity.
