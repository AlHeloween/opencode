# Fix: System-Reminder Wrapper → DB-Persisted Synthetic Parts

**Date**: 2026-06-21  
**Status**: complete  
**Problem**: `<system-reminder>` wrapper applied via in-place text mutation (`p.text = [...]`) caused 33.4k KV cache misses when `lastFinished` advanced between turns. Old messages lost their wrapper on DB reload but the guard prevented re-wrapping → position-based cache invalidation.

---

## Root Cause

`prompt.ts:1459-1483` — The `<system-reminder>` wrapper mutated user message text in-place. When `lastFinished` advanced (new assistant with `finish: true`), the guard `m.info.id <= lastFinished.id` prevented re-wrapping old messages. On message reload from DB, old messages came back unwrapped but in KV cache they were wrapped → fingerprint mismatch from that position forward → entire suffix recomputed.

**Evidence**: Log `1782044471578_diff_...diff` showed user #18 wrapped in turn-18, then unwrapped in turn-1 with 33.4k input tokens.

## Fix: Task 1.1-1.4

### Changes

| File | Change | Lines |
|------|--------|-------|
| `packages/opencode/src/session/prompt.ts` | Replace in-place `p.text = [...]` wrapper with DB-persisted synthetic part + `ignored: true` on original | 1459-1519 |
| `packages/opencode/src/session/prompt.ts` | Narrow plan-mode `hasSynthetic` prefix to `"<system-reminder>\nPlan mode"` | 319 |
| `packages/opencode/src/session/prompt/reasoning.txt` | Add RAG operational workflow notes | 185-200 |

### How it works

1. **Wrapper creation**: Instead of mutating `p.text`, create a NEW `synthetic: true` text part via `sessions.updatePart()` containing the full wrapper (with user text inlined)
2. **Original text preservation**: Mark the original text part as `ignored: true` (also persisted) so `toModelMessagesEffect` skips it
3. **Idempotency**: `alreadyWrapped` check on parts with `synthetic: true` + text starting with `<system-reminder>` prevents re-wrapping on reload/tool-loop
4. **Render order**: Synthetic part prepended via `unshift()` so it renders first; original (ignored) is excluded by the `!part.ignored` guard at `message-v2.ts:850`

### Rendered output (identical to before)

```
<system-reminder>
The user sent the following message:
{actual user text}

Please address this message and continue with your tasks.
</system-reminder>
```

### Why this fixes the cache break

| Scenario | Before (in-place mutation) | After (synthetic part) |
|----------|---------------------------|----------------------|
| User #18 wrapped, assistant finishes | Text mutated → KV cache has wrapped version | Synthetic part persisted in DB → fingerprint stable |
| Next turn: messages reloaded from DB | #18 comes back UNWRAPPED → fingerprint mismatch → 33k miss | #18 has synthetic part → fingerprint MATCHES → cache hit |
| New user #21 arrives | #21 gets wrapped, #18 stays unwrapped (guard) | #18 keeps its synthetic part forever, #21 gets its own |
| Tool-loop iteration | Rewrap check `p.text.includes(...)` prevents growth | `alreadyWrapped` check prevents duplicate synthetic parts |

### Oracle

- [x] Typecheck: `tsgo --noEmit` — clean (no errors)
- [x] RAG index: incremental reindex — 10 docs updated (only changed files)
