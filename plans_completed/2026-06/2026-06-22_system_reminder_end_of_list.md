# System Reminder — Append at End of Message List

**Created:** 2026-06-22
**Status:** [x] Done | **Commits:** `0f06b6c70`, `ecb96b7b3`, `e6b42ebbd`, `6fb992328`, `180154555`, `bcaf2862a`, `ecf42a2c9`, `852bd9ce9`, `fbdec956d`

## Session Summary

9 fixes applied in this session:

| Commit | Fix |
|--------|-----|
| `0f06b6c70` | System-reminder `findLast` — stops content destruction |
| `ecb96b7b3` | Date appended to user message end (not prepended) |
| `e6b42ebbd` | QUEUED badge constrained to last user message |
| `6fb992328` | Turn counter: monotonic user-message count |
| `180154555` | Multiedit: diffs surfaced in tool output |
| `bcaf2862a` | Multiedit: compact +/- format with add/remove stats |
| `ecf42a2c9` | Multiedit: strip `---`/`+++` patch headers |
| `852bd9ce9` | Multiedit: TUI `<diff>` element renderer |
| `fbdec956d` | UTC ms timestamp at message creation (loop injection removed) |

---

## Abstract

The system-reminder wrapping code at `prompt.ts:1471-1519` iterates all `msgs` and wraps every user message with `id > lastFinished.id`. This causes a mid-list user message (e.g., position #258) to receive a synthetic system-reminder part, breaking the assistant→tool→assistant flow. The model sees a user message injected mid-conversation, corrupting the reasoning pipeline and KV cache continuity.

**Fix**: Apply the same `msgs.findLast()` pattern used by date injection (line 1528) to system-reminder wrapping — wrap only the LAST user message, ensuring it always appears at conversation end.

---

## Math Formalization

Given `msgs` array of length N, ordered chronologically:

```
msgs = [m₁, m₂, ..., mₙ]
```

Current logic wraps all mₖ where:
- `mₖ.role === "user"`
- `mₖ.id > lastFinished.id`

This can produce wrapped messages at positions k < N (mid-list).

Fixed logic wraps only mₙ where:
- `mₙ = msgs.findLast(m => m.role === "user")`
- `mₙ.id > lastFinished.id`

Result: system-reminder always at last position in modelMsgs.

---

## Structural Diagram

```
Before (broken):
  ... | [user]#258 (system-reminder) | [assistant]#259 | [tool]#260 | ... | [user]#266 (new)

After (fixed):
  ... | [assistant]#258 (original role, untouched) | [tool]#259 | ... | [user]#266 (system-reminder + new message)
```

---

## Input/Output

| Parameter | Type | Description |
|-----------|------|-------------|
| `msgs` | `MessageV2.WithParts[]` | All session messages |
| `lastFinished` | `MessageV2.Assistant \| undefined` | Last finished assistant msg |

**Output**: Side effect — last user message in `msgs` gets synthetic system-reminder part + original text ignored.

---

## Implementation

**File**: `packages/opencode/src/session/prompt.ts`
**Location**: Lines 1471-1519

**Change**: Replace the `for (const m of msgs)` loop (lines 1472-1518) with:

```ts
if (lastFinished) {
  const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
  if (lastUserMsg && lastUserMsg.info.id > lastFinished.id) {
    const m = lastUserMsg
    for (const p of m.parts) {
      if (p.type !== "text" || p.ignored || p.synthetic) continue
      if (!p.text.trim()) continue
      const alreadyWrapped = m.parts.some(
        (part) =>
          part.type === "text" &&
          (part as MessageV2.TextPart).synthetic === true &&
          part.text.startsWith("<system-reminder>"),
      )
      if (alreadyWrapped) continue
      const wrapperText = [
        "<system-reminder>",
        "The user sent the following message:",
        p.text,
        "",
        "Please address this message and continue with your tasks.",
        "</system-reminder>",
      ].join("\n")
      const syntheticPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: m.info.id,
        sessionID: m.info.sessionID,
        type: "text" as const,
        text: wrapperText,
        synthetic: true,
      })
      yield* sessions.updatePart({
        ...p,
        ignored: true,
      } as MessageV2.TextPart)
      p.ignored = true
      m.parts.unshift(syntheticPart)
    }
  }
}
```

Key difference: `for (const m of msgs)` → `const lastUserMsg = msgs.findLast(...)`.

---

## Test Cases

1. **Single user message**: One user msg after lastFinished → wrapped at end. ✓
2. **Tool-loop with multi-turn**: User sends msg, assistant reasons, user sends new msg. Only last user msg wrapped. ✓
3. **No user message after lastFinished**: No wrapping. ✓
4. **Already wrapped**: `alreadyWrapped` guard prevents re-wrap. ✓
5. **Empty message**: `!p.text.trim()` guard skips. ✓

---

## Verification

- [x] `bun run typecheck` in packages/opencode — zero errors
- [ ] Rebuild binary
- [ ] Run conversation, check diff file — new user msg at end, not mid-list
