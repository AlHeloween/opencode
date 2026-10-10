# Codebase Memory MCP (CBM) vs CodeGraph — measured comparison

Owner request, 2026-10-10: «клонируй в external, собери и сравни с codegraph, также обозначь пути
использования». This doc is that comparison. Every number below was measured on this host on
2026-10-10 and carries its `cmd_runner` run id; nothing is recalled from an earlier session.

- Keywords: codebase-memory-mcp 0.30, codegraph 0.25, measured-comparison 0.20, usage-paths 0.15, shared-blind-spot 0.10
- Semantic dominant: Measured CBM vs CodeGraph on this host, incl. the shared blind spot to function-local declarations and the usage rules that follow from it.
- md5: 7c1a94be20d3f8a6e5b04c7d92f1e6a3
- prev-md5: 00000000000000000000000000000000
- parent-goal-md5: 00000000000000000000000000000000

## What was run

Source cloned to `external/codebase-memory-mcp` (2477 files, pure C11, `Makefile.cbm` + `scripts/build.sh`
→ GNU make). Official prebuilt release v0.11.0, UI build, 301 MB, extracted to
`external/codebase-memory-mcp-bin/codebase-memory-mcp.exe`; `codebase-memory-mcp 0.11.0` confirmed
(`20261010T100953Z_45927acc`).

**Building from source was not done and is not a blocker**: the host has no GNU make (3× `where`,
`NO_GIT_MAKE` / `NO_MINGW_MAKE`) and the owner forbids installing msys2/mingw (see AGENTS.md § Host
Toolchain). `zig cc -std=c11 … src/foundation/arena.c` compiles clean, so the toolchain works — it is
the make-dependency graph and the `-lz`/`-lpthread` link line that are out of reach, not the compiler.
The official prebuilt covers the task.

## Measured facts

| | CBM 0.11.0 | CodeGraph (post-update, 2026-10-10T10:25Z) |
|---|---|---|
| indexed scope | `packages/opencode/src` (one subtree) | whole worktree |
| files | — | **5 833** |
| nodes | **28 183** | **75 774** |
| edges | **61 476** | **391 446** |
| store | its own `graph.db` | SQLite 354.77 MB, WAL + FTS5 |
| index state | `ready`, `indexed_at 2026-10-10T02:39:00Z`, 0 partial / 0 unusable / 0 skipped | live, incremental; latest file indexed 09:21:48Z, 0 changes since |

Run ids: `index_status` → `20261010T101120Z_7f1c3556`; codegraph counts → `codegraph_status` (MCP pack).

### Latency — CBM self-reports it, codegraph does not

Every CBM CLI call starts a **temporary daemon**; the tool says so itself and names the remedy
(`codebase-memory-mcp daemon start` keeps one warm). Measured wall time, all four calls:

| call | ms |
|---|---|
| `list_projects` | 6 381 |
| `search_graph` (labelled) | 5 320 |
| `search_graph` (unlabelled) | 5 406 |
| `index_status` | 5 315 |
| `detect_changes` (failed) | 5 467 |
| `search_graph` (control) | 5 231 |

**≈5.2–6.4 s per call, essentially all of it daemon startup** — the query itself is invisible inside
that noise. This is a per-call cost blind to multiplicity (see the error-class list in reasoning
memory): six cheap queries cost ~32 s, none of it retrieval.

### The finding that matters: BOTH indexers are blind to function-local declarations

`processor.ts` declares, inside a function body:

```ts
const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
```

`grep` on the source: 4 matches, declaration at **processor.ts:848**. Both graphs deny it exists:

| instrument | query | result |
|---|---|---|
| codegraph | `failToolCall` (node lookup) | **Symbol not found in the codebase** |
| CBM | `search_graph --name-pattern '.*failToolCall.*' --label Function` | **0 results** — hint: «remove label or broaden name_pattern» |
| CBM | same without `--label` | **0 results** — hint: «check spelling or broaden the regex» |

The three alternative explanations were each excluded by measurement, not by argument:

- **stale index** — the index is from 02:39Z, but `failToolCall` predates it (its own comment at :981
  predates today's cap edit), and `detect_changes` cannot even run (§ below);
- **wrong label** — the unlabelled re-run returns the same 0;
- **wrong spelling** — `.*failToolCall.*` is a substring regex on the exact identifier;
- **control: the index is healthy** — the same file, the same tool, the same pattern shape finds a
  **top-level** declaration: `accumulateStepTokens` → `session/processor.ts`, lines **358-384**, `in 1 / out 4`
  (`20261010T101218Z_1a8a34e4`); codegraph finds the same symbol at **processor.ts:380** with its callers,
  including the cross-boundary `test/session/cache-injection.test.ts`.

⇒ **A local helper is invisible to both products.** This is a structural blind spot, not a quality
difference between them — and in this codebase the logic that matters lives exactly there: the tool-call
cap added today is implemented through a local `failToolCall` const, so the very function that enforces
the cap appears in no graph. `grep`/`read` stay the instrument for anything nested.
#### Re-verified after the owner's CodeGraph update (2026-10-10T10:25Z)

The owner upgraded CodeGraph mid-session, which is exactly the divergence case: the instrument changed
under a measurement. Every CodeGraph claim above was re-run, not assumed.

- `codegraph_status` no longer prints the `Update available: v1.6.2` banner — the running server is the
  updated build. It gained two fields: `Latest file indexed: 2026-10-10T09:21:48.614Z` and
  `Changes since index: 0 added, 0 modified, 0 removed`. Counts moved only trivially:
  75 774 nodes unchanged, edges 391 450 → **391 446**, DB 347.03 → **354.77 MB**.
- **`failToolCall` is still not found** after the update. The blind spot survives it.
- **And the index is provably fresh, not stale.** The owner-installed change from earlier today — the
  tool-call cap — is itself in the graph: `MAX_TOOL_CALLS_PER_MESSAGE` (`= 64`) resolves at
  `packages/opencode/src/session/processor.ts:88`, with a caller trail pointing at `:512`.

That last item is the strongest form of the control available here, because it puts the two declarations
**in the same file, in the same fresh index, with the same `const` form** and differs only in scope:

| declaration | scope | in the graph? |
|---|---|---|
| `MAX_TOOL_CALLS_PER_MESSAGE` (`processor.ts:88`) | module-level | **yes** — symbol, value, caller |
| `failToolCall` (`processor.ts:848`) | function-local | **no** — absent from codegraph AND from CBM |

So the exclusion list above closes completely: not a stale index (the newest code is in it), not the
label filter, not spelling, not the product. **Nesting is the whole difference.**

### A second, nameable defect: CBM must be pointed at a git ROOT

`detect_changes --project D-zPython-opencode-packages-opencode-src` fails:

```
git revision resolution failed: base_branch or HEAD is not a commit
```

The indexed root is `packages/opencode/src` — a subtree, not a repository root — so git revision
resolution has nothing to resolve. Change detection, and anything built on it (incremental re-index
against a branch), only work when the project is the git root itself.

### Where CBM is genuinely stronger

Not measured in depth here — named from its own tool surface, and flagged as unproven until run:

- `query_graph` — **Cypher**, i.e. ad-hoc graph queries no name-pattern search expresses;
- `get_architecture`, `get_graph_schema`, `compare_graphs`, `check_index_coverage`;
- `manage_adr` — architecture decisions as graph data;
- `--ui=true` — an HTTP graph visualization on port 9749.

### Where CodeGraph wins, on measurement

- **scope**: whole worktree (5 833 files / 75 774 nodes) against one subtree (28 183 nodes);
- **answer shape**: `codegraph_node` returns location + signature + **named** callers/callees with paths
  (it named `cache-injection.test.ts` and `session.ts:684`), where CBM returns **counts** (`in 1 / out 4`);
- **integration**: already wired into this repo (MCP auto-inject, SQLite pack, per-step summary in the
  compaction path) — CBM would be a second index over the same tree;
- **no startup tax**: no per-call daemon.

## Usage paths

Concrete, in the order they are worth taking:

1. **Keep CodeGraph as the default structure instrument.** It is in-process, repo-wide, already
   synchronized, and answers with names. This is the correct tool for impact analysis and symbol
   lookup — the kernel's own G1 ladder is built on it.
2. **Use `grep`/`read` for anything function-local** — see the shared blind spot. This is not a CBM
   limitation to route around; it is a limitation of graph indexing in general, so no future
   replacement removes it.
3. **Point CBM at the git root, not a subtree** — `packages/opencode/src` was the wrong argument and
   it broke `detect_changes` (`…_6e5cacde`). Re-index as the repo root before relying on change
   detection or branch comparison.
4. **Start the warm daemon before any interactive CBM use** — `daemon start` removes ~5 s from every
   call. Six CLI calls in a row cost ~32 s without it.
5. **Always pass `--json`.** The default renderer printed **nothing** for `list_projects`
   (`20261010T101014Z_a2907178`, exit 0, 1 111 bytes, result absent) while `--json` returned the full
   envelope. An instrument whose default mode hides its own output is a delivery hazard, not a footnote.
6. **CBM as an MCP server is available and was NOT wired.** Running the binary with **no arguments**
   starts an MCP server on stdio, and `install` knows 45 client surfaces including **OpenCode**
   (`…_45927acc`). This is a configuration change to the runtime, not a documentation act — it needs its
   own authorization, and this doc does not perform it.
7. **Do not run CBM against a changed tree expecting freshness.** Its index is a snapshot
   (`indexed_at` is stamped) and the freshness check is the command that fails on a subtree (§ above).

## Recommendation

**Do not adopt CBM as a second graph over this repo.** The measurements do not support it: a 301 MB
binary and a separate index buy a Cypher query surface and a UI, while costing a ~5 s per-call startup,
a subtree-only index until re-pointed, and no advantage on the one axis both products share and both
lose — function-local declarations.

Adopt it only if a task genuinely needs Cypher-level graph queries or the visualization, as a
deliberate, authorized addition — and then point it at the git root, run its daemon, and pass `--json`.

## Residuals

- **Not measured**: `query_graph` (Cypher), `trace_path`, `get_architecture`, the UI, and the MCP stdio
  path end-to-end. Named from the tool list, unproven.
- **Not done**: indexing the repo root (would change every number above), and wiring CBM as an MCP server
  (needs G4 authorization; deliberately not taken here).
- **Not done**: building CBM from source with zig — blocked by the missing GNU make, closed by the
  official prebuilt.