# Documentation Surface Index

**Created:** 2026-05-18
**Last Audited:** 2026-06-24
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
| `docs/ADID_Framework_15_3.md` | ADID team | Epistemic markers, semantic vectors, AGI Reasoning Kernel | production | 2026-06-24 |
| `docs/architecture.md` | OpenCode team | System architecture diagrams: prompt, checkpoint, agents, media, cache/diff | production | 2026-06-24 |
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
| `plans/20260623_remaining_items.md` | OpenCode team | active — Part 3 verified, 6 deferred | 2026-06-24 |

---

## Completed Plans (`plans_completed/`) — 95 plans

| Key recent completions | Owner | Status | Last Verified |
|----------|-------|--------|---------------|
| `plans_completed/20260624_module_cd_plan.md` | OpenCode team | completed | 2026-06-24 |
| `plans_completed/20260623_agent_pipeline_media_plan.md` | OpenCode team | completed — all 4 modules | 2026-06-24 |
| `plans_completed/20260623_capability_stabilization_plan.md` | OpenCode team | completed | 2026-06-24 |
| `plans_completed/20260623_B_agent_pipeline.md` | OpenCode team | completed | 2026-06-24 |
| `plans_completed/20260623_C_media_tui.md` | OpenCode team | completed | 2026-06-24 |
| `plans_completed/20260623_D_multimodal.md` | OpenCode team | completed | 2026-06-24 |
| `plans_completed/20260601_complete_remaining_items.md` | OpenCode team | completed | 2026-06-23 |
| `plans_completed/PERF_PLAN.md` | OpenCode team | completed | 2026-05-18 |
| ... | ... | ... | ... |

---

## CI/CD Workflows (`.github/workflows/`)

28 workflow files covering: typecheck, test (unit+e2e), publish, deploy, containers, PR/issue triage, docs, Nix, AI agent, stats. See `index.md` for the folder map.

---

## Verification

Run `adm --verify-all docs specs` for clean report on documentation integrity.
