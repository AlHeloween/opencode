# Checkpoint Reasoning Prefix Fix

**Created:** 2026-06-26
**Status:** Complete
**Effort:** ~2h

## Abstract

Fix three compounding checkpoint bugs that caused cold cache starts (733K+ tokens burned) and lobotomized agents (reasoning.txt stripped after first turn).

## Bugs Fixed

### [x] Bug 1: Reasoning prefix stripped on checkpointed turns
- **File:** `llm.ts`
- **Root cause:** `!isCheckpoint` guard skipped `reasoning.txt` + provider prompt injection for checkpointed turns
- **Impact:** Agent ran without AGI identity/gated workflow after first turn → lobotomized behavior
- **Fix:** Checkpoint V2 includes reasoning prefix at save time; llm.ts skips re-injection for loaded checkpoints

### [x] Bug 2: Dead date extraction code
- **File:** `llm.ts`
- **Root cause:** `dynamicIndex` searched system prompt for "Today's date:" which was never injected (dates go to user messages via `prompt.ts:1021`)
- **Impact:** Dead code with no runtime effect, but confusing maintenance
- **Fix:** Removed `dynamicIndex`/`dynamicSystem` extraction; simplified to direct push of stable system + optional user.system

### [x] Bug 3: Summary guard missing `SUMMARY_SAFE_TOOLS` check
- **File:** `processor.ts`
- **Root cause:** Second guard (`tool-call` case at line 393) threw unconditionally on summary, missing `SUMMARY_SAFE_TOOLS.has()` check that first guard had
- **Impact:** `skill` tool killed during compaction → compaction failed
- **Fix:** Added `&& !SUMMARY_SAFE_TOOLS.has(value.toolName)` to second guard

## Architecture

```
Checkpoint V2 (self-contained):
  [reasoning.txt + provider prompt]  ← frozen at save time
  [session banner, rules, env, skills, instructions]
  ↑ Immune to binary updates

llm.ts:
  checkpoint loaded → skip injection → use checkpoint as-is
  fresh turn → inject reasoning.txt from live source

Binary update + reasoning.txt change:
  1. Load V2 checkpoint → old reasoning → cache HIT
  2. Eventually compaction triggers → fresh build → new reasoning
  3. New V2 checkpoint → new reasoning frozen
```

## Migrations

- `CHECKPOINT_VERSION` bumped 1→2
- V1 checkpoints rejected → one-time cold rebuild → V2 saved

## Commits

| Commit | Description |
|--------|-------------|
| `08485102f` | Fix summary guard for `tool-call` case |
| `185a2ffe2` | Fix: never strip reasoning prefix for checkpoints |
| `4cffa49aa` | Cleanup: remove dead date extraction |
| `d95a1410f` | Self-contained checkpoints V2 |
| `7b7850956` | Always inject reasoning (intermediate - superseded by V2) |
