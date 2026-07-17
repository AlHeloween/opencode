"""
Repository Folder Map — defined as typed Python data.

All directories tracked in the RepoMap dataclass below.
Use this as the canonical reference for project layout.
"""

from dataclasses import dataclass, field

@dataclass
class DirEntry:
    path: str
    purpose: str
    entrypoint: str = ""

@dataclass
class RepoMap:
    """Complete folder-based repository index."""
    last_updated: str = "2026-07-12"
    
    packages: list[DirEntry] = field(default_factory=lambda: [
        DirEntry("packages/opencode/", "Core CLI/TUI server — AI agent, tools, HTTP API, session mgmt", "src/index.ts"),
        DirEntry("packages/app/", "SolidJS SPA — web UI for chat, sessions, settings", "src/entry.tsx"),
        DirEntry("packages/core/", "Shared utilities — global paths, filesystem, npm resolution, Effect", "src/global.ts"),
        DirEntry("packages/ui/", "Shared SolidJS components (40+), themes, Pierre diff engine", "package.json"),
        DirEntry("packages/sdk/js/", "Auto-generated TypeScript SDK from OpenAPI", "src/index.ts"),
        DirEntry("packages/plugin/", "Plugin system API — hooks, tool helpers, TUI APIs", "src/index.ts"),
        DirEntry("packages/desktop/", "Tauri v2 desktop app (Rust + TypeScript)", "src/index.tsx, src-tauri/src/main.rs"),
        DirEntry("packages/desktop-electron/", "Electron v41 desktop app", "src/main/index.ts"),
        DirEntry("packages/web/", "Astro marketing site + Starlight docs (opencode.ai)", "src/pages/[...slug].md.ts"),
        DirEntry("packages/enterprise/", "SolidStart app — session sharing + sync", "src/app.tsx"),
        DirEntry("packages/function/", "Cloudflare Worker — sharing sync, GitHub App token", "src/api.ts"),
        DirEntry("packages/console/app/", "SaaS dashboard — billing, workspaces, admin", "Vite/SolidStart root"),
        DirEntry("packages/console/core/", "SaaS business logic — accounts, billing, Drizzle", "src/account.ts"),
        DirEntry("packages/console/function/", "Cloudflare Worker — OpenAuth, log processing", "src/auth.ts"),
        DirEntry("packages/console/mail/", "Email templates (React/jsx-email)", "emails/templates/"),
        DirEntry("packages/console/resource/", "SST resource definitions", "resource.cloudflare.ts"),
        DirEntry("packages/script/", "Shared build script utilities (version mgmt)", "src/index.ts"),
        DirEntry("packages/storybook/", "UI component Storybook", ".storybook/preview.tsx"),
        DirEntry("packages/containers/", "CI/CD Docker images", "base/Dockerfile"),
        DirEntry("packages/brand/", "Brand/logo assets (SVG + PNG)", "mark.svg"),
        DirEntry("packages/slack/", "Slack integration", ""),
    ])

REPO = RepoMap()

# {len(REPO.packages)} packages tracked
# Docs: docs/, specs/plans/, plans_completed/
#   docs/rendering.md       — Full rendering pipeline: LLM → terminal, TUI components, streaming, mermaid, images
#   docs/architecture.md    — Prompt system, checkpoint, compaction, KV cache
#   docs/compaction.md      — Mechanistic continuous memory (summaries + links + message*)
#   docs/ADID_Framework_15_4.md — ADID update manager framework
# Tools: tools/, external/
# Key files at root: package.json, bunfig.toml, turbo.json, tsconfig.json, sst.config.ts
