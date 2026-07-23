# CodeGraph MCP (live graph contract)

**Status:** required for live structural intelligence in this fork  
**Plan:** `plans/2026-07-23_codegraph_mcp_only.md`

## Hard rules

1. **MCP only** while the graph is live — `codegraph serve --mcp`.
2. While MCP is active, **SQLite is blocked** and **CLI graph queries are blocked**.
3. **Soft-fail is forbidden.** MCP down → hard-fail (tools / fossil impact). No empty “success.” Without MCP, a real reindex is ~20 minutes — not an agent fallback.
4. Fossil file diffs get structural expansion via the **same MCP explore** path as the smoke test.

## Config (opencode)

`opencode.json` is often gitignored. Add (or merge):

```json
{
  "mcp": {
    "codegraph": {
      "type": "local",
      "command": ["codegraph", "serve", "--mcp"],
      "enabled": true,
      "timeout": 120000,
      "environment": {
        "CODEGRAPH_MCP_TOOLS": "explore,search,callers,callees,impact,node,files,status"
      }
    }
  }
}
```

Installer snippet: `codegraph install --print-config opencode`.

## Default vs full tools

| Default (vendor) | Full set (opencode wrappers) |
|------------------|------------------------------|
| `codegraph_explore` | explore, search, callers, callees, impact, node, files, status |

Set `CODEGRAPH_MCP_TOOLS` as above so impact/search modes work.

## Opencode surfaces

| Surface | Backend |
|---------|---------|
| Built-in `codegraph` tool | MCP (`codegraph/mcp-client.ts`) |
| `Snapshot.impact` / track `sym` tag | MCP explore on fossil changed files |
| Agent MCP tools list | same server via `mcp.codegraph` |

## Smoke (from `packages/opencode`)

```bash
bun test/codegraph/mcp_diff_smoke.ts           # fossil diff → MCP explore
bun test/codegraph/mcp_down_hardfail_smoke.ts  # MCP down must hard-fail
bun test test/codegraph/mcp-client-args.test.ts
```

## Activation notes

- Bootstrap may run `codegraph init` if no DB; it does **not** spawn a second detached MCP process.
- The stdio MCP client owns `serve --mcp` (watcher + tools + exclusive access).
