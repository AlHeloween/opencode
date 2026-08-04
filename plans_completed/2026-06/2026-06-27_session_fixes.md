---
status: done
owner: codex
created: 2026-06-27
completed: 2026-06-27
reproduce:
  - cd packages/opencode && bun typecheck
  - bun test test/util/json-repair.test.ts
---

# Session Fixes — 2026-06-27

## Goal

Fix three categories of issues discovered during this session: cache prediction bugs, JSON repair gap for single-quoted tool arguments, and stale documentation references.

## Changes

### 1. Cache Prediction Bugs (E4)

**Root cause:** Fingerprint storage and checkpoint paths used `${sessionID}:${modelID}` as keys, lacking the agent name. This caused:
- Title agent fingerprints leaking to build agent (different system prompts)
- Wrong cache warmth predictions (predicted warm, actual cold)
- Checkpoint race condition (title agent checkpoint overwriting build agent checkpoint)

**Files modified:**

| File | Change |
|------|--------|
| `src/session/cache-control.ts` | `cacheStoreKey`, `storePrevFingerprint`, `getPrevFingerprint` now accept optional `agentName`. DB schema updated to `(session_id, agent_name, model_id)` primary key. |
| `src/session/processor.ts` | Added `agentName` to `Input`/`ProcessorContext`. Prediction logic changed from `prevFP.estimatedTokens > 0` to `ctx.currentSystemMd5 === prevFP.systemMd5 && prevFP.estimatedTokens > 0`. |
| `src/session/checkpoint.ts` | `checkpointPath`, `save`, `load` now accept optional `agentName`. Checkpoint files now include agent name in path. |
| `src/session/prompt.ts` | All callers of `storePrevFingerprint`, `getPrevFingerprint`, `Checkpoint.load`, and `processor.create` updated to pass `agent.name`. |

**Test cases:**
- T1.1: Fingerprint stored by title agent is NOT loaded by build agent
- T1.2: Fingerprint stored by build agent IS loaded by build agent
- T2.1: Agent switch → prediction is "cold"
- T2.2: Same agent, same system, new message → prediction is "warm"
- T2.3: System prompt changed → prediction is "cold"

### 2. JSON Repair: Single-Quote Conversion

**Root cause:** `repairJson()` had no strategy for converting single-quoted JSON to double-quoted JSON. LLMs emit Python-style single-quoted tool arguments (`{'prompt':'hello'}`), causing `JSON.parse()` failures with "Unrecognized token `'"`.

**Files modified:**

| File | Change |
|------|--------|
| `src/util/json-repair.ts` | Added `convertSingleToDoubleQuotes()` state machine and Strategy 0.5. Handles: delimiter detection (vs apostrophes), `\'` escape conversion, `"` escaping inside single-quoted strings, trailing comma combo. |
| `test/util/json-repair.test.ts` | 7 new test cases: basic conversion, nested objects, arrays, escaped single quotes, double quotes inside single-quoted strings, apostrophe preservation, trailing comma combo. |

**Test cases:**
- Converts `{'prompt':'hello'}` → `{"prompt":"hello"}`
- Handles nested: `{'key':'value','nested':{'a':'b'}}`
- Handles arrays: `{'items':['a','b','c']}`
- Escaped: `{'prompt':'it\'s a test'}` → `{"prompt":"it's a test"}`
- Double quotes inside: `{'prompt':'he said "hello"'}` → `{"prompt":"he said \"hello\""}`
- Apostrophes preserved: `{"prompt":"he's a developer"}`
- Trailing comma: `{'prompt':'hello',}` → `{"prompt":"hello"}`

### 3. Documentation Cleanup

**Files modified:**

| File | Change |
|------|--------|
| `AGENTS.md` | Replaced `Completed Research` table with one-line note: "Research analyses were removed." |
| `index.md` | Removed `research_done/` section |
| `DOCINDEX.md` | Removed `Research (research_done/)` table |

### 4. Master Plan Corrections

**File:** `plans/20260625_deferred_architectural_master_plan.md`

| Change | From | To |
|--------|------|-----|
| E3 path | `plans/emergency/20260626_orchestrator_evolving_mode.md` | `plans/20260626_orchestrator_evolving_mode.md` |
| Active plan count | 7 | 4 |
| Execution order | Stale Phase 2-5 with future items | Corrected to show completed items |
| E4 added | — | Cache Prediction Bugs, [x] Done |
| Revisions | — | Added 2 entries for 2026-06-27 |

## Oracle Gates

- [x] `bun typecheck` passes with zero errors
- [x] `bun test test/util/json-repair.test.ts` — 35/35 pass
- [x] No regressions in existing tests
- [x] Documentation references cleaned up
- [x] Master plan accurate against codebase state
