# CodeGraph MCP (live graph contract)

**Status:** required for live structural intelligence in this fork  
**Plan:** `plans/2026-07-23_codegraph_mcp_only.md`

## Hard rules

1. **MCP owns the live graph** — `codegraph serve --mcp` (writer + watcher).
2. **Agent/fossil path is hybrid:** MCP touch (refresh) → **readonly SQLite pack** (structure). MCP prose is suppressed (too noisy for agents).
3. **Soft-fail is forbidden.** MCP down → hard-fail. Without MCP, reindex ~20m is not a fallback.
4. Concurrent **readonly** SQLite under WAL is OK after MCP touch; never write the DB from opencode.

## Config (opencode)

### Automatic (default)

When config is loaded, opencode **auto-injects** `mcp.codegraph` if:

- it is **not** already set in any config layer, and  
- `.codegraph/` exists **or** `codegraph` is on PATH (incl. `Global.Path.bin`), and  
- env is not opting out: `OPENCODE_CODEGRAPH_MCP=0|false|off|no`

Injected shape:

```json
{
  "type": "local",
  "command": ["codegraph", "serve", "--mcp"],
  "enabled": true,
  "timeout": 120000,
  "environment": {
    "CODEGRAPH_MCP_TOOLS": "explore,search,callers,callees,impact,node,files,status"
  }
}
```

This is **in-memory** on load (no write to gitignored `opencode.json`). MCP service then starts stdio `serve --mcp` like any other local MCP server.

### Manual override

Set `mcp.codegraph` explicitly in `opencode.json` / global config to customize or disable:

```json
{ "mcp": { "codegraph": { "enabled": false } } }
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
| Built-in `codegraph` tool | **MCP touch → SQLite pack** (`mcpTouchQueryThenSqlitePack`) |
| `Snapshot.impact` / track `sym` tag | **MCP touch → SQLite pack** (`mcpTouchThenSqlitePack` + `KINDS\|TOP\|IMPACT`) |
| Agent MCP tools list | same server via `mcp.codegraph` (optional raw explore) |

Env: `CODEGRAPH_HYBRID_DEBOUNCE_MS` (default `500`) between MCP touch and SQLite read.

## Smoke (from `packages/opencode`)

```bash
bun test/codegraph/mcp_diff_smoke.ts           # fossil diff → MCP explore
bun test/codegraph/mcp_down_hardfail_smoke.ts  # MCP down must hard-fail
bun test test/codegraph/mcp-client-args.test.ts
```

## Activation notes

- Bootstrap may run `codegraph init` if no DB; it does **not** spawn a second detached MCP process.
- The stdio MCP client owns `serve --mcp` (watcher + tools + exclusive access).
