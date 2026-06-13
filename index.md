# Repository Folder Map

**Last updated:** 2026-06-13
**Purpose:** Folder-based index of repository contents — purpose + key entrypoints for each directory.

---

## Top-Level Directories

### `packages/` — Main Monorepo Packages (21 packages)
| Subfolder | Purpose | Key Entrypoint |
|-----------|---------|----------------|
| `opencode/` | Core CLI/TUI server — AI agent engine, tools, HTTP API, session mgmt | `src/index.ts` |
| `app/` | SolidJS SPA — web UI for chat, sessions, settings | `src/entry.tsx` |
| `core/` | Shared utilities — global paths, filesystem, npm resolution, Effect services | `src/global.ts` |
| `ui/` | Shared SolidJS component library (40+ components), themes, Pierre diff engine | `package.json` exports 14 entrypoints |
| `sdk/js/` | Auto-generated TypeScript SDK client + server from OpenAPI | `src/index.ts` |
| `plugin/` | Plugin system API — hook definitions, tool helpers, TUI APIs | `src/index.ts` |
| `desktop/` | Tauri v2 desktop app (Rust + TypeScript) | `src/index.tsx` (renderer), `src-tauri/src/main.rs` (Rust) |
| `desktop-electron/` | Electron v41 alternative desktop app | `src/main/index.ts` (main), `src/renderer/index.tsx` (renderer) |
| `web/` | Astro marketing site + Starlight docs (`opencode.ai`) | `src/pages/[...slug].md.ts` |
| `enterprise/` | SolidStart app for session sharing + sync | `src/app.tsx` |
| `function/` | Cloudflare Worker — sharing sync, GitHub App token exchange | `src/api.ts` |
| `console/app/` | SaaS dashboard — billing, workspaces, admin (SolidStart) | Vite/SolidStart root |
| `console/core/` | SaaS business logic — accounts, billing, Drizzle schemas | `src/account.ts`, `src/workspace.ts` |
| `console/function/` | Cloudflare Worker — OpenAuth, log processing | `src/auth.ts` |
| `console/mail/` | Email templates (React/jsx-email) | `emails/templates/` |
| `console/resource/` | SST resource definitions (Cloudflare + Node) | `resource.cloudflare.ts` |
| `script/` | Shared build script utilities (version mgmt) | `src/index.ts` |
| `storybook/` | UI component Storybook dev tool | `.storybook/preview.tsx` |
| `containers/` | CI/CD Docker images (base, bun-node, rust, tauri, publish) | `base/Dockerfile` |
| `brand/` | Brand/logo assets (SVG + PNG) | `mark.svg`, `mark-512x512.png` |
| `slack/` | Slack integration | — |

---

### `docs/` — Technical Documentation
- `ADID_Framework_15_3.md` — Autodidactic Development & Intelligence Driver Framework v15.3
- `external-file-locations.md` — All file paths opencode reads/writes outside project worktree
- `README.md` — Docs directory index

### `specs/` — Architecture Specifications
- `project.md` — API spec for project/session management
- `v2/` — v2 API proposals
- `effect/` — Effect migration patterns (migration, schema, tools, routes, HTTP API, facades, instance-context, loose-ends, server-package)

### `plans/` — Active Plans
- `20260605_preexisting_provider_git_init.md` — Provider/git-init test failure fixes
- `20260604_project_analysis_issues.md` — Project analysis issue backlog
- `20260601_upstream_adoption_phase2.md` — Upstream adoption phase 2 tracking
- `20260601_complete_remaining_items.md` — Remaining implementation items tracking

### `plans_completed/` — Completed Plans
Performance, logging, security, shell migration, file locations, backups, session ops, watchdog/cache cleanup, runtime path cleanup, bug fixes, more.

### `research_done/` — Completed Research Documents
- `research_v4.md` — Fix-oriented security/correctness triage
- `research_v5_cache_collapse_investigation.md` — Cache collapse investigation
- `20260604_katcoder_cache_regression_investigation.md` — Kat-coder cache regression investigation
- `20260605_preexisting_test_failures_fix.md` — Pre-existing test failure analysis

### `obsolete/` — Deprecated Reference Artifacts
- `plans/` — Retired active plans that were superseded or invalidated by later architectural decisions

---

### `infra/` — Infrastructure-as-Code (SST)
- `app.js` — App deployment
- `console.js` — Console deployment
- `enterprise.js` — Enterprise deployment

### `scripts/` — Build & Dev Scripts
- `build_artefacts.py` — Agent artefact builder
- `sync_agent_assets.py` — Agent asset sync
- `dev_env_windows.cmd`, `dev_env_windows.ps1` — Dev environment setup

### `script/` — Repository Scripts
- Root-level utility scripts

### `tools/` — Tool Binaries
- `adm.exe`, `adm` — ADID Update Manager (declarative updates, verification, RAG)
- `cmd_runner.exe` — Windows ConPTY command runner with log bridge

### `sdks/` — External SDKs
- `vscode/` — VS Code extension

### `.opencode/` — OpenCode Agent Configuration
- `rules/` — Agent rule files (ADID framework, semantic coding)
- `skills/` — Agent skill definitions (adm-exe, cmd-runner, rag, etc.)
- `data/` — Runtime data (gitignored, portable)

### `.github/` — GitHub Configuration
- `workflows/` — 28 CI/CD workflows (typecheck, test, publish, deploy, triage, docs, etc.)
- `PULL_REQUEST_TEMPLATE.md`
- `CODEOWNERS`

### `artifacts/` — Build Artifacts
Compiled binaries, packages, and installers.

### `bin/` — Binary Outputs
Compiled CLI executables.

### `dist/` — Distribution Builds
Production build output directory.

### `experiments/` — Experiments
Short-lived experimental code — not for mainline.

### `futures/` — Future Work
Planned features / drafts not yet ready for mainline.

### `obsolete/` — Deprecated Artifacts
Kept for reference only.

### `makeups/` — Stubs/Makeups
Explicit stubs when something cannot be executed for real.

### `updates/` — ADID Update Descriptors (Source of Truth)
XML descriptors for declarative code changes, verification, and rollback.

### `logs/` — Runtime Logs (gitignored)
cmd_runner and application runtime logs.

### `.opencode/data/diffs/` — KV Cache Diff Logs (gitignored)
Per-request section-aware structural diffs (META/SYSTEM/MESSAGES) between consecutive LLM requests for KV cache miss debugging. Files named `{ISO8601-ms}_{provider}_{model}.diff`. Enabled by default (config `diff_requests`). Per-session FIFO rotation (max 200 per model).

### `nix/` — Nix Build Support
Nix flake for reproducible builds.

---

## Key Files at Root

| File | Purpose |
|------|---------|
| `package.json` | Monorepo root — workspaces, scripts, dependency catalog |
| `bunfig.toml` | Bun configuration (preloads, test preload) |
| `turbo.json` | Turborepo task pipeline |
| `tsconfig.json` | Root TypeScript config |
| `sst.config.ts` | SST (Serverless Stack) deployment config |
| `bun.lock` | Dependency lockfile |
| `_build.ps1`, `_build_rust.ps1` | Build scripts |
| `cmd_runner.exe` | Windows ConPTY command runner |
| `adm.exe` | ADID Update Manager |
| `adm.json` | ADID configuration |
