# Cache Break Debug — System Hash Instability Investigation

## Master Plan

```
Gate 1: STATE  →  Gate 2: DECOMPOSE  →  Gate 3: PLAN  →  Gate 6: GROUND  →  Gate 7: IMPLEMENT  →  Gate 8: VERIFY  →  Gate 9: CLEAN
```

## Abstract

open-code session `ses_0feb35c70ffe45p1tdT8K93Ekm` showed **36 cold turns** (1.56M tokens burned) with **4–9 consecutive misses per cluster**. `checkSystemStability()` in `llm.ts` detects system hash changes mid-session but only logs the hash values — not WHAT changed. This plan instruments, reproduces, identifies, and fixes the root cause.

## Evidence Map

| Claim | Evidence | Weight |
|-------|----------|--------|
| 36 cold turns in session, 1.56M tokens burned | DB query: `message` table, `tokens.input > 5000` | [Exact] |
| Clusters of 4–9 consecutive cold turns | Time-ordered input token pattern: 34K→37K→38K→39K | [Exact] |
| `checkSystemStability` fired at 17:06:36 with hash mismatch | Log: `prevHash: 11629440226478205000, newHash: 5191353888246483000` | [Exact] |
| System assembly components appear static within a session | Code analysis: `instructionCache` computed once, `Instance.directory` static, agent unchanged | [Inferred] |
| Checkpoint save is forked (`Effect.forkIn`), non-blocking | Code: `prompt.ts:1367,1776` | [Exact] |
| Prior breaks (5 events) predate our checkpoint changes | DB: cold turns at 15:40, 15:48, 15:51, 16:00, 16:01 UTC | [Exact] |

## Goals & Tasks

### SG1: Instrumentation — Content diff on hash change [x]

- [x] **SG1.1**: Add `systemContentPrev` Map to store previous content
- [x] **SG1.2**: Modify `checkSystemStability()` to log `diffLine`, `oldLine`, `newLine`, `oldLen`, `newLen`
- [x] **SG1.3**: Verify instrumentation compiles and runs

**Verification**: `bun run` in sandbox, check logs for new fields.

### SG2: Sandbox — Isolated reproduction environment [x]

- [x] **SG2.1**: Create `experiments/20260626_cache_break_debug/` with `_run.cmd`
- [x] **SG2.2**: Fresh `.opencode/` DB, isolated config
- [x] **SG2.3**: Verify sandbox starts via `cmd_runner`

**Verification**: `cmd_runner start --shell cmd --cwd experiments/... -- _run.cmd`

### SG3: Reproduction — Trigger and capture cache break [ ]

- [ ] **SG3.1**: Add API key to sandbox `_run.cmd` (remove `SET DEEPSEEK_API_KEY=`)
- [ ] **SG3.2**: Start sandbox, send 3+ sequential prompts via `cmd_runner`
- [ ] **SG3.3**: Check logs for `checkSystemStability` warnings with `diffLine`/`oldLine`/`newLine`
- [ ] **SG3.4**: If no break occurs naturally, attempt trigger candidates:
  - Edit `reasoning.txt` between turns (file-change hypothesis)
  - Toggle `format.type` between `text` and `json_schema` (checkpoint rejection hypothesis)
  - Insert instruction file in `.opencode/rules/` mid-session (instruction injection hypothesis)
  - Fork checkpoint save delay (race condition hypothesis)

**Verification**: At least one `checkSystemStability` warning captured with non-empty `diffLine`.

### SG4: Root Cause — Identify the exact line that changes [ ]

- [ ] **SG4.1**: From captured diff, identify which system prompt component changed
- [ ] **SG4.2**: Trace backward to find why that component is non-deterministic
- [ ] **SG4.3**: Document root cause with code reference

**Verification**: Root cause statement with file:line evidence.

### SG5: Fix — Make system prompt deterministic [ ]

- [ ] **SG5.1**: Implement fix based on root cause
- [ ] **SG5.2**: Verify fix eliminates hash changes (no more `checkSystemStability` warnings)
- [ ] **SG5.3**: Verify consecutive cold turns stop (cache hits on every turn after first)

**Verification**: Zero `checkSystemStability` warnings in 10+ consecutive turns. Cache ratio > 0.95.

### SG6: Cleanup [ ]

- [ ] **SG6.1**: Move plan to `plans_completed/`
- [ ] **SG6.2**: Commit all changes
- [ ] **SG6.3**: Remove or archive sandbox

## Hypothesis Catalog

| # | Hypothesis | Likelihood | Test |
|---|-----------|------------|------|
| H1 | Editing `reasoning.txt` between turns changes `instruction.rules()` cache | Low | `instructionCache` is scoped to Effect runtime, should survive file changes within session |
| H2 | `Checkpoint.load()` flips between null and data mid-session | Medium | Check if `checkpointUsable` changes between turns (SG3.4: check `format.type` toggle) |
| H3 | Plugin hook `experimental.chat.system.transform` modifies system | Low | No plugin registered for this hook |
| H4 | Forked checkpoint save races with next turn's load | Medium | SG3.4: insert delay in checkpoint save |
| H5 | `instruction.resolve()` injects volatile instructions from read files | Medium | Check if instruction claims leak into system prompt |
| H6 | `sys.skills()` returns different output due to permission or discovery changes | Low | Same agent, permissions static |
| H7 | `system[]` array length changes → collapse operation differs → hash changes | Medium | Check `systemMsgCount` in cache marker logs |
| H8 | Compaction invalidates checkpoint, fresh assembly differs from checkpointed version | High | Check if compaction events precede cold streaks |

## Test Cases

### TC1: Baseline — single session, no changes
1. Start sandbox with stable reasoning.txt
2. Send 5 prompts
3. Expect: first turn cold, turns 2-5 warm (cache hits)

### TC2: File change mid-session
1. Start sandbox
2. Send 2 prompts (warm up cache)
3. Edit `reasoning.txt` (add/remove a line)
4. Send 2 more prompts
5. Expect: `checkSystemStability` fires, `diffLine` shows the changed line

### TC3: Compaction trigger
1. Start sandbox, send many prompts to fill context
2. Wait for auto-compaction
3. Expect: first post-compaction turn may be cold; check if subsequent turns stabilize

### TC4: Binary restart
1. Start sandbox, send prompts, cache is warm
2. Stop TUI, restart with same binary
3. Expect: first turn after restart may be cold; subsequent should be warm

---

*Created: 2026-06-26*
