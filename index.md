# Repository Folder Map

**Last updated:** 2026-05-18
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
- `bug-resolution-plan.md` — Bug catalog and triage
- `20260518_project_health_plan.md` — Project health improvements

### `plans_completed/` — Completed Plans (22 plans)
Performance, logging, security, shell migration, file locations, backups, session ops, bug fixes, more.

### `research/` — Research Documents
- `research_v1.md` — Initial comparative analysis of `Local_Development` branch
- `research_v2.md` — Deeper static analysis with identified bugs
- `research_v3.md` — Runtime analysis with microbenchmarks

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
