# Plan: Organize `.gitignore` with Comment Headers

## Summary

Reorganize the root `.gitignore` (`D:\zPython\opencode\.gitignore`) by grouping entries into logical categories with clear `#` comment headers. Remove duplicate entries. The `experiments/` folder is **already excluded** (line 62) — this task is purely organizational.

## Current State

- 93 lines, no comment headers, scattered entries
- 4 duplicates identified: `dist`/`dist/`, `.jj`/`.jj/`, `.serena` patterns, VCS patterns
- `experiments/` already present on line 62 ✓

## Target Structure

Entries grouped into 14 sections with `# ── Section Name ──` headers:

| Section | Entries |
|---------|---------|
| **IDE / Editor** | `.idea`, `.vscode`, `.DS_Store`, `Session.vim`, `*~` |
| **VCS Isolation** | `**/.git/`, `.git/`, `**/.jj`, `**/.jj/`, `.jj`, `.jj/` |
| **Fossil SCM** | `_FOSSIL_`, `_fossil`, `.fslckout`, `*.fsl`, `FSL_*.db`, `FSL_*.db-journal`, `.fossil-settings/` |
| **Environment & Config** | `.env`, `.direnv/`, `/opencode.json`, `opencode.jsonc`, `gateway.jsonc`, `auth.json` |
| **Dependencies** | `node_modules` |
| **Build Outputs** | `dist/`, `target`, `ts-dist`, `tsconfig.tsbuildinfo`, `*.bun-build`, `__pycache__/`, `.build-cache/`, `.turbo` |
| **Binaries & Artefacts** | `artefacts/`, `bin/`, `bin_tst/`, `opencode-dev`, `opencode.exe`, `dxcompiler.dll`, `dxil.dll` |
| **Logs & Temp** | `logs/`, `tmp`, `.temp/`, `.tst/`, `.sst` |
| **Experiments & Playground** | `experiments/`, `playground`, `test_deep/`, `refs` |
| **Backups & Restore** | `*.backup_*`, `*.baseline`, `*.adid.log.jsonl`, `src.bak/`, `**/src.bak` |
| **Project Tooling** | `.opencode`, `.codex`, `.reasonix`, `.serena/`, `**/.serena`, `.scripts`, `.adid_rag/`, `.worktrees` |
| **Zig** | `zig-global`, `packages/opentui/packages/core/src/zig/.zig-global/`, etc. |
| **Packages** | `external/`, `packages/wasm/external/`, `packages/wasm/stringzilla/`, `packages/enterprise/.opencode/`, `packages/opencode/.opencode/data/opencode.db` |
| **Docs & Misc** | `docs/opencode.db.sql`, `UPCOMING_CHANGELOG.md`, `/result` |

## Deduplication

| Remove | Keep | Reason |
|--------|------|--------|
| `dist` (line 52, no trailing slash) | `dist/` (line 61) | `dist/` is more standard for directories |
| `.jj` (line 28, redundant with 29) | `**/.jj` + `.jj/` | Glob-scoped + local dir is clearer intent |
| `.opencode/data` + `.opencode/project.db` (lines 31-32) | `.opencode` (line 30) | Whole dir ignore covers subpaths |
| `"dxcompiler.dll"` `"dxil.dll"` quoted | Unquoted `dxcompiler.dll` `dxil.dll` | Quotes unnecessary for these filenames |

## Files Modified

1. **`D:\zPython\opencode\.gitignore`** — Full rewrite: reorganize into sections with headers, deduplicate, fix quoting

## Verification

1. `git status` — verify no new untracked files appear that were previously ignored
2. `git check-ignore experiments/` — confirm the directory is still ignored
3. `git check-ignore dist/` — confirm build output still ignored
4. Spot-check: `git check-ignore .idea .vscode node_modules` — all return the path (ignored)
