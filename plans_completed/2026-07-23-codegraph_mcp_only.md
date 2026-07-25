# CodeGraph MCP-only alignment (hard-fail if MCP down)

**Date**: 2026-07-23  
**Status**: Complete — production hybrid smoke suite green
**Paradigm**: AGENTS.md outer-loop — CodeGraph MCP owns freshness; after its touch, the dedicated readonly SQLite pack is the bounded structural reader.

## Context

- **MCP inactive** → real reindex/sync costs ~**20 minutes** (or worse). Not a viable fallback for agent turns.
- **MCP active** → direct reader calls and CLI reindex/query operations are blocked. The permitted path is **MCP touch → dedicated readonly SQLite pack**; it neither owns freshness nor starts an index.
- Soft-fail / silent skip when MCP is down is **unacceptable**: tools look alive, graph is dead or triggers millennial reindex → stalled development.

## Prior art (REUSE.BEFORE)

- Vendor contract: `codegraph serve --mcp`; default tool `codegraph_explore`; optional `CODEGRAPH_MCP_TOOLS=explore,search,callers,callees,impact,node,files,status`.
- Watcher + ~2s debounce lives **inside** the MCP process.
- opencode MCP layer already supports local stdio servers (`ConfigMCP.Local`, `MCP.connectLocal`).
- `codegraph install --print-config opencode` emits the correct mcp block.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (before implementation edits)
| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | Inspect `tool/codegraph.ts` + `codegraph/reader.ts` | Direct SQLite hot path | Confirmed (pre-change) |
| 2 | `opencode.json` mcp | No codegraph entry | Confirmed |
| 3 | Bootstrap `serve --mcp` detached | stdio ignored watcher only | Confirmed |

### Post-implementation oracles
| # | Command / check | Pass criteria |
|---|-----------------|---------------|
| 1 | Config has local `mcp.codegraph` → `codegraph serve --mcp` | Present, enabled, timeout adequate |
| 2 | Session with `.codegraph/`: MCP status connected; tools include explore | Connected; tool callable |
| 3 | Built-in `codegraph` tool with MCP down | **Hard fail** clear message — not empty success |
| 4 | Built-in `codegraph` with MCP up | Non-empty explore/impact text via MCP |
| 5 | `Snapshot.impact` with MCP down + `.codegraph/` | Hard fail / explicit error — not `undefined` soft skip |
| 6 | No hot-path imports of reader SQL from tool/fossil for live graph | Grep clean |
| 7 | Bootstrap does not dual-spawn detached MCP when config owns stdio | Single owner |
| 8 | `bun test/codegraph/mcp_diff_smoke.ts` (from packages/opencode) | Vendor MCP/Fossil connectivity only; not the production hybrid acceptance oracle |
| 9 | `bun test/codegraph/mcp_down_hardfail_smoke.ts` | Raw transport failure only; not the configured app-service failure oracle |
| 10 | `bun test test/codegraph/mcp-client-args.test.ts` | exploreArgsForChangedFiles / tag helpers |

### Gate
- [x] Smoke requirements written
- [x] Baseline recorded (pre: direct SQL; post: MCP path)
- [x] Implementation only after baseline
- [x] Post-impl smoke **#8** passed [Exact] 2026-07-23 — `addecde9c6→62ac36573c`, 12 files, MCP explore 19481 chars
- [x] Post-impl smoke **#9** passed [Exact] — MCP-down hard-fail
- [x] Post-impl **#10** unit helpers pass

## Goals

1. **Single owner**: CodeGraph live graph = MCP process only.
2. **All opencode codegraph surfaces** trigger MCP freshness, then use only the dedicated readonly SQLite pack (not raw SQL or CLI while MCP owns graph).
3. **Hard-fail** if MCP unavailable when a codegraph operation is requested (tool, impact, structural tag when index present). Never silent success.
4. **Ensure connect** on demand before fail (try `MCP.connect("codegraph")` once), then fail if still down.
5. Remove / stop bootstrap detached `serve --mcp` that competes with stdio MCP client.

## Non-goals

- Train or reindex logic inside opencode.
- Keeping dual SQL “fast path” for agents.
- Soft-degrade to empty ImpactSummary.

## Implementation steps

### 1. Config
- [x] Auto-inject local `mcp.codegraph` when `.codegraph/` exists (`codegraph-mcp-auto.ts`; command `codegraph serve --mcp`, timeout 120s), without hand-editing project `opencode.json`.
- [x] Set env `CODEGRAPH_MCP_TOOLS` to include tools needed by opencode wrappers: at least `explore,impact,callers,callees,search,status` (product default may list only explore to agents; wrappers need named tools).

### 2. MCP service
- [x] Add `callTool(server, toolName, args)` on `MCP.Service` for programmatic use.
- [x] `codegraph/mcp-client.ts`: `callCodegraphMcp` / optional runtime — connect if needed, **Effect.fail** if unavailable (no soft-skip).

### 3. Built-in `codegraph` tool
- [x] Replace direct SQL with MCP tool calls (explore default; map modes → MCP tools).
- [x] On failure: hard Effect failure — no fake empty graph.

### 4. Fossil structural impact
- [x] `impact` / track tagging / `lastImpact` use the hybrid MCP-touch → readonly-pack path when `.codegraph/` is present.
- [x] MCP down → hard fail (no catch to undefined/void).
- [x] Stop using `reader.ts` SQL on these paths.

### 5. Bootstrap
- [x] Keep `codegraph init` if no DB (one-time).
- [x] **Remove** detached `serve --mcp` with stdio ignore (MCP config owns the process).

### 6. Docs / AGENTS
- [x] Note MCP-only + hard-fail; point to this plan and vendor MCP contract.

## Forbidden

- Soft-fail / empty success when MCP is down.
- Direct reader calls or CLI query/reindex for live agent/fossil graph while MCP is the freshness owner. The `sqlite-pack` module remains the permitted readonly reader after a successful MCP touch.
- Dual MCP processes (detached + stdio client) fighting locks.

## Production smoke closure (2026-07-23)

The older scripts prove raw vendor connectivity and a deliberately broken transport. They do **not** exercise Opencode's configured `MCP.Service`, the production hybrid wrapper, Fossil tag round-trip, or the summary/`message*` hand-off. This section is the acceptance contract.

### Baseline (before this test closure)

| # | Command (cwd: `packages/opencode`) | Actual [Exact] | Gap |
|---|---|---|---|
| 1 | `bun test test/codegraph/no-sqlite-hotpath.test.ts test/codegraph/mcp-client-args.test.ts test/codegraph/mcp-client.effect.test.ts test/codegraph/sqlite-pack.test.ts` | **21 pass, 0 fail** | Component/static coverage only; its MCP service is mocked. |
| 2 | `bun test/codegraph/mcp_diff_smoke.ts` | **PASS**; Fossil `bd5fd0b6b8 → 4cac895d70`, 3 files, raw MCP explore response 23,267 chars | Bypasses Opencode `MCP.Service` and does not inspect the readonly pack. |
| 3 | `bun test/codegraph/mcp_down_hardfail_smoke.ts` | **PASS** | Starts a bogus raw stdio client, rather than failing the app's configured service. |

### Required post-change oracles

- [x] **Configured-service hybrid smoke:** `bun test/codegraph/mcp_hybrid_production_smoke.ts` — real `MCP.Service`, Fossil `bd5fd0b6b8 → 4cac895d70`, 3 input files, 203 symbols, 103 cross-file edges, non-empty `sym` tag. No CodeGraph reindex/query CLI.
- [x] **Fossil impact/tag-read smoke:** `bun test/codegraph/fossil_hybrid_impact_smoke.ts` — real `Snapshot.impact()` produced 3 changed files / 103 callers and `lastImpact()` decoded 7 tag kinds / 20 top symbols. `Snapshot.track()` tag-write is implemented but intentionally outside this read-only shared-worktree smoke; it needs a controlled indexed fixture before being claimed as test coverage.
- [x] **Summary hand-off integration:** the system computes a range impact in `SessionSummary.summarize`, stores it on the synthetic summary parent, and `message*` renders it. `bun test test/session/summary.test.ts` (11 pass) directly proves `Snapshot.impact(from,to)` attachment and defect/log omission; `bun test test/session/compaction.test.ts --test-name-pattern structural-summary-handoff` (1 pass) proves preservation.
- [x] **Configured-service failure smoke:** `bun test/codegraph/mcp_configured_down_smoke.ts` — a configured local command with a missing executable fails explicitly (`not connected`; ~64s Windows stdio timeout), never an empty pack.
- [x] **Regression suite:** four component/static files remain **21 pass**; raw vendor-contract scripts remain supplemental coverage.

### Completion gate

- [x] Record exact commands and outputs for all required post-change oracles.
- [x] Reconcile this plan only after the production suite is green.

## Acceptance

- [x] Static hot-path guard: no raw reader SQL in live tool/fossil paths (21-pass component/static suite).
- [x] Configured MCP unavailable → production hybrid hard-fail, no empty pack.
- [x] Configured MCP up → useful MCP refresh plus non-empty readonly structural pack.
- [x] Plan smoke oracles recorded.
