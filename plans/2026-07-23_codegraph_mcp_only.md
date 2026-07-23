# CodeGraph MCP-only alignment (hard-fail if MCP down)

**Date**: 2026-07-23  
**Status**: Implemented (smoke oracles pending live MCP session)  
**Paradigm**: AGENTS.md outer-loop — structural authority is CodeGraph; when MCP owns the graph, no other path is legal.

## Context

- **MCP inactive** → real reindex/sync costs ~**20 minutes** (or worse). Not a viable fallback for agent turns.
- **MCP active** → **SQLite blocked**, **CLI blocked**. Direct `bun:sqlite` / `codegraph explore` from opencode is illegal and stalls or fights the daemon.
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
| 8 | `bun test/codegraph/mcp_diff_smoke.ts` (from packages/opencode) | fossil diff files → MCP explore hard-fail if MCP down; PASS with non-empty structural text |
| 9 | `bun test/codegraph/mcp_down_hardfail_smoke.ts` | connect with bogus binary → hard-fail (exit 0 only if fail) |
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
2. **All opencode codegraph surfaces** call MCP tools (not SQL, not CLI while MCP owns graph).
3. **Hard-fail** if MCP unavailable when a codegraph operation is requested (tool, impact, structural tag when index present). Never silent success.
4. **Ensure connect** on demand before fail (try `MCP.connect("codegraph")` once), then fail if still down.
5. Remove / stop bootstrap detached `serve --mcp` that competes with stdio MCP client.

## Non-goals

- Train or reindex logic inside opencode.
- Keeping dual SQL “fast path” for agents.
- Soft-degrade to empty ImpactSummary.

## Implementation steps

### 1. Config
- [x] Add `mcp.codegraph` local to project `opencode.json` (command `codegraph serve --mcp`, timeout ≥ 60s).
- [x] Set env `CODEGRAPH_MCP_TOOLS` to include tools needed by opencode wrappers: at least `explore,impact,callers,callees,search,status` (product default may list only explore to agents; wrappers need named tools).

### 2. MCP service
- [x] Add `callTool(server, toolName, args)` on `MCP.Service` for programmatic use.
- [x] `codegraph/mcp-client.ts`: `callCodegraphMcp` / optional runtime — connect if needed, **Effect.fail** if unavailable (no soft-skip).

### 3. Built-in `codegraph` tool
- [x] Replace direct SQL with MCP tool calls (explore default; map modes → MCP tools).
- [x] On failure: hard Effect failure — no fake empty graph.

### 4. Fossil structural impact
- [x] `impact` / track tagging / `lastImpact` use MCP only when `.codegraph/` present.
- [x] MCP down → hard fail (no catch to undefined/void).
- [x] Stop using `reader.ts` SQL on these paths.

### 5. Bootstrap
- [x] Keep `codegraph init` if no DB (one-time).
- [x] **Remove** detached `serve --mcp` with stdio ignore (MCP config owns the process).

### 6. Docs / AGENTS
- [x] Note MCP-only + hard-fail; point to this plan and vendor MCP contract.

## Forbidden

- Soft-fail / empty success when MCP is down.
- Direct SQLite or CLI for live agent/fossil graph while MCP is the owner.
- Dual MCP processes (detached + stdio client) fighting locks.

## Acceptance

- [ ] Grep: tool + fossil hot path no `bun:sqlite` / `symbolsInFilePaths` for live queries
- [ ] MCP down + codegraph tool → hard fail message
- [ ] MCP up + explore → useful text
- [ ] Plan smoke oracles recorded
