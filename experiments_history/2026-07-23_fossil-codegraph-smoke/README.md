# Fossil × CodeGraph smokes

## MCP diff smoke (canonical — use this)

Live graph via **MCP only**. Fossil brief diff → `codegraph_explore` over stdio.

```bash
# from packages/opencode (needs MCP SDK resolution)
cd packages/opencode
bun test/codegraph/mcp_diff_smoke.ts              # fossil diff → MCP explore
bun test/codegraph/mcp_diff_smoke.ts <from> <to>
bun test/codegraph/mcp_down_hardfail_smoke.ts     # MCP down must hard-fail
bun test test/codegraph/mcp-client-args.test.ts   # pure helper unit tests
```

Requires: `.codegraph/` at repo root, `codegraph` on PATH, fossil checkout with ≥2 commits (or explicit hashes).

**Hard-fail** if MCP cannot connect or explore returns empty. Soft-skip forbidden.

## Sandbox: `external/codegraph-rust` (isolated fossil)

Nested fossil checkout (does not touch monorepo fossil):

- Repo: `.opencode/data/fossil-sandbox-codegraph-rust/snapshot.fsl`
- Local root: `external/codegraph-rust/`
- Index: `external/codegraph-rust/.codegraph/` (already ~277 files)

```bash
# compare SQLite vs MCP on a real one-file "db fix" diff
cd packages/opencode
$env:OPENCODE_ROOT = "d:\zPython\opencode\external\codegraph-rust"   # pwsh
bun test/codegraph/compare_mcp_vs_sqlite.ts 4e313214ca f7e2e83c30
bun test/codegraph/mcp_diff_smoke.ts 4e313214ca f7e2e83c30
```

Example sandbox commits:
- `4e313214ca` baseline sources
- `f7e2e83c30` fix(db): `concurrent_access.rs` (WAL reader pragmas + MCP policy note)

## Legacy SQL scripts

`structural_diff.py` / `check_schema.py` hit SQLite directly — **not** valid while MCP owns the graph. Keep only for offline schema diagnostics when MCP is **not** running.