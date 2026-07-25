# Layer-1 summary after completed answer

**Date**: 2026-07-24
**Status**: Completed

## Context / goal

Layer-1 summary must be a post-answer maintenance turn. It must never interrupt an assistant while it is reasoning, calling tools, or continuing its user task. After the normal assistant response finishes, the system requests and accepts an Inferred summary, attaches its Exact range impact, then creates one synthetic resume turn so the agentic flow continues. The later `message*` must render both the already-persisted Fossil changed-file handle and the CodeGraph structural handle; compaction must not recompute either.

## Prior art

reuse: N/A — this is a local persisted-session state-machine correction. CodeGraph located the existing `result === "stop"` injection point and the two mid-loop injection sites; no reusable external component owns this message lifecycle.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (before implementation edits)

| # | Command (cwd: `packages/opencode`) | Expected now | Actual [Exact] |
|---|---|---|---|
| 1 | `bun typecheck` | exit 0 | **pass** — `tsgo --noEmit` (2026-07-24) |
| 2 | `bun test test/session/compaction.test.ts --test-name-pattern structural-summary-handoff` | pass | **1 pass, 67 filtered, 0 fail** (2026-07-24) |

### Post-implementation oracles

| # | Command (cwd: `packages/opencode`) | Pass criteria |
|---|---|---|
| 1 | `bun test test/session/prompt.test.ts --test-name-pattern "Layer-1"` | Live flow proves completed-answer ordering, no mid-tool summary, accepted-summary recovery, post-stop recovery, bounded retry/cooldown, and one resume turn. |
| 2 | `bun test test/session/compaction.test.ts --test-name-pattern "summary"` | Summary boundary/structural handoff tests pass. |
| 3 | `bun typecheck` | exit 0. |
| 4 | `bun test/codegraph/fossil_hybrid_impact_smoke.ts` and `bun test/codegraph/mcp_hybrid_production_smoke.ts` | Real Fossil sidecar range → configured incremental CodeGraph MCP touch → readonly SQLite structural pack → `Snapshot.impact` passes without a project reindex. |

### Gate

- [x] Smoke requirements written
- [x] Baseline recorded [Exact]
- [x] Implementation only after baseline
- [x] Post-implementation smoke passed [Exact] — Layer-1 ordering smoke passes; terminal cooldown passes with its Windows-safe 30s budget; compaction summary: **18 pass, 0 fail**; `bun typecheck`: exit 0. Earlier real Fossil-sidecar → configured MCP → SQLite production smokes pass (2026-07-24).

## Implementation steps

- [x] Treat a summary-range user message as a persisted summary attempt only for tool suppression; mark an assistant as `summary` only after it returns a valid Inferred body.
- [x] Request Layer-1 only from a completed normal `stop` result with no pending tool work; remove pre-dispatch and continued-step injection. The completed-assistant early-exit path durably recovers a due post-stop summary after restart.
- [x] Validate required summary sections before promotion/stamping; keep invalid attempts out of compaction boundaries and bind bounded retries to their original request parent. Persist `summary-terminal` as an ignored part on exhausted requests; pending scans ignore terminal requests, and cooldown lasts until a later real user message.
- [x] Bypass the completed-assistant early exit while the latest summary request remains retryable, so an invalid non-summary attempt reaches its bounded retry rather than ending the loop.
- [x] Move only **summary-range** Fossil/CodeGraph enrichment from summary-request start to accepted-summary promotion so diffs/impact belong to the accepted handle. Ordinary per-user-turn Modified Files updates remain unchanged.
- [x] After exactly one accepted summary, create one synthetic resume turn; recover idempotently on restart when acceptance was persisted but resume was not. Do not resume after a failed/terminal attempt and do not duplicate the same accepted range. A later resumed answer can still become eligible after its own completed stop.
- [x] Add live prompt-flow smoke coverage for post-answer ordering, no tools, successful resume, invalid retry, terminal failure/restart, accepted-summary restart recovery, **post-stop restart recovery**, and a threshold-crossing tool loop.
- [x] Update `docs/compaction.md` to match the completed-answer + resume lifecycle.
- [x] Add an error-first compaction test that proves the accepted summary's precomputed Fossil file diff and CodeGraph impact are both rendered into `message*`; pass the stored handle through the builder without calling Fossil or CodeGraph during compaction.
- [x] Repair all live Fossil/CodeGraph smokes to query the portable runtime Fossil sidecar, then prove a real snapshot range reaches configured CodeGraph MCP without a project reindex.
- [x] Serialize temporary test instances and await rotated log-stream closure before cleanup so process-global portable paths cannot make the compaction smoke flaky on Windows.
- [x] Await the accepted summary's soft-failing range enrichment before creating its synthetic resume, and add a smoke that proves the resume sees the persisted handle.
