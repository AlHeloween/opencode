"""
External File Locations — all paths opencode reads/writes outside worktree.

Defined as typed Python data below.
"""

from dataclasses import dataclass, field

@dataclass
class FilePath:
    path: str
    purpose: str

@dataclass
class ExternalPaths:
    """All external file paths opencode uses outside the project worktree."""
    
    data_root: str = "{worktree}/.opencode/data/"
    config_root: str = "{exeDir}/"
    
    data_paths: list[FilePath] = field(default_factory=lambda: [
        FilePath("opencode.db", "SQLite database"),
        FilePath("opencode.db-wal", "Write-ahead log"),
        FilePath("opencode.db-shm", "Shared memory file"),
        FilePath("log/", "Log/diff/payload files (kept: 100)"),
        FilePath("log/dev.log", "Dev mode log"),
        FilePath("cache/", "Cached data"),
        FilePath("cache/bin/", "Downloaded binaries (ripgrep, ESLint, gopls)"),
        FilePath("cache/skills/", "Skill discovery cache"),
        FilePath("state/", "Per-project state"),
        FilePath("state/model.json", "Recently used model/provider"),
        FilePath("state/plugin-meta.json", "Plugin metadata"),
        FilePath("storage/", "JSON storage (session diffs, legacy)"),
        FilePath("backups/<sessionID>/", "Edit tool backups (kept: 50/session)"),
        FilePath("tool-output/", "Truncated tool output cache"),
        FilePath("tmp/", "Temporary files"),
        FilePath("plans/", "Plan documents (when no project VCS)"),
    ])
    
    exe_paths: list[FilePath] = field(default_factory=lambda: [
        FilePath("auth.json", "OAuth provider credentials"),
        FilePath("mcp-auth.json", "MCP server OAuth tokens"),
        FilePath("opencode.jsonc", "Global config (JSON with comments)"),
        FilePath("opencode.json", "Global config (JSON)"),
        FilePath("gateway.jsonc", "Gateway configuration"),
        FilePath("AGENTS.md", "Global agent instructions"),
    ])
    
    project_paths: list[FilePath] = field(default_factory=lambda: [
        FilePath(".opencode/data/", "All runtime data (gitignored)"),
        FilePath(".opencode/opencode.json", "Project config"),
        FilePath(".opencode/gateway.jsonc", "Project gateway config"),
        FilePath(".opencode/AGENTS.md", "Project agent instructions"),
        FilePath(".opencode/agent/", "Project agent definitions"),
        FilePath(".opencode/command/", "Project custom commands"),
        FilePath(".opencode/skill/", "Project skills"),
        FilePath(".opencode/tool/", "Project custom tools"),
        FilePath(".opencode/themes/", "Project themes"),
        FilePath(".opencode/plugins/", "Project plugins"),
    ])
    
    env_vars: dict[str, str] = field(default_factory=lambda: {
        "OPENCODE_DB": "DB file path override",
        "OPENCODE_CONFIG": "Custom config file path",
        "OPENCODE_CONFIG_DIR": "Custom config directory",
        "OPENCODE_PURE": "Pure mode (skip non-essential ops)",
        "OPENCODE_FAST_BOOT": "Skip startup checks",
        "OPENCODE_SERVER_PASSWORD": "Server auth password",
        "OPENCODE_SERVER_USERNAME": "Server auth username",
        "OPENCODE_CLIENT": "Client identifier",
    })

PATHS = ExternalPaths()
# Data root: {PATHS.data_root}, Config root: {PATHS.config_root}
# {len(PATHS.data_paths)} data paths, {len(PATHS.exe_paths)} exe paths, \
# {len(PATHS.project_paths)} project paths, {len(PATHS.env_vars)} env vars
