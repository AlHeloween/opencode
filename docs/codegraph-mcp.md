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

**Process lifecycle — the tree ends with opencode (2026-10-07).** `serve --mcp` is only a proxy: it spawns a
DETACHED per-project daemon `serve --mcp --path <root>` (+ a `node -e` watchdog) that outlives its last client by
300 s (codegraph `mcp/daemon.js`, `CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS`). opencode kills each stdio server's whole tree
twice over: the MCP state finalizer (`killTree`, on instance dispose) and `src/mcp/exit-reaper.ts` (synchronous, on
the process `exit` event — the one that still runs when `process.exit()` skips every finalizer, as `opencode run`
does on a session error). Before the reaper, that error exit left the daemon holding a fresh workspace ✓ measured
(`experiments_history/2026-10-07_codegraph-mcp-orphan/`); guard: `test/mcp/exit-reaper.test.ts`. A hard kill (SIGKILL,
Task Manager) still bypasses both — the daemon then reaps itself after its idle timeout.

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
| `Snapshot.impact` (on demand) | **MCP touch → SQLite pack** (`mcpTouchThenSqlitePack`) |
| `SessionSummary.summarize` (per step) | readonly SQLite; `impact.from = codegraph-sqlite-cache` |
| `SessionSummary.enrichRange` (range cadence) | **MCP touch → SQLite pack** |
| Agent MCP tools list | same server via `mcp.codegraph` (optional raw explore) |

Env: `CODEGRAPH_HYBRID_DEBOUNCE_MS` (default `500`) between MCP touch and SQLite read.

### Пауза после инструмента — 2026-10-02

✓ Журнал сессии XEComponents и read-back SQLite выделили 45.519 s ожидания между записью
session diff и обновлением user summary. Прямой MCP probe вернул `waited 45s in the queue`.
Последовательный `summarize` вызывал этот запрос после каждого шага по накопленным diff,
включая `read` и `run`. Теперь этот путь читает готовый индекс; обновление через MCP
сохраняется в `enrichRange`. Кэшированный impact не доказывает свежесть индекса.

✓ Регрессия `summary-exact-live.test.ts` читает сохранённые diff и символ из настоящих
Session/SQLite без MCP runtime; исходная версия теряет символ, исправленная сохраняет.
Проверка запущенного бинарника требует отдельного применения сборки; `bin/` здесь не менялся.

## Smoke (from `packages/opencode`)

```bash
bun test/codegraph/mcp_diff_smoke.ts           # fossil diff → MCP explore
bun test/codegraph/mcp_down_hardfail_smoke.ts  # MCP down must hard-fail
bun test test/codegraph/mcp-client-args.test.ts
```

## Activation notes

- Bootstrap may run `codegraph init` if no DB; it does **not** spawn a second detached MCP process.
- The stdio MCP client owns `serve --mcp` (watcher + tools + exclusive access).
