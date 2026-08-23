# Concept: Undo/Redo across the compaction boundary

**Status:** PROPOSED — awaiting approval before implementation
**Date:** 2026-08-23
**Trigger:** user-reported: "undo after compact must restore the window state as
before the compact — this used to work, redo too"

---

## 1. Archaeology (why it used to work)

| Era | Mechanism |
|-----|-----------|
| jj era (≤ Jul 4, `63e088ff7d^`) | Files only: `jj op restore` / `restore --from`. No DB interplay. |
| Fossil early (Jul 4…) | Full-leaf `checkout --force`. `sessions.messages()` returned **all** rows — no `compacted` column existed yet, so the undo walk saw the whole history. Undo across a compaction boundary therefore restored the pre-compact window "for free". |
| **`37034dc760` (Jul 25) — regression point** | Added `message.compacted` column + default filtering in `MessageV2.page` ("load visible checkpoint deltas"). From here `sessions.messages()` hides compacted rows → the undo walk is blind below the compaction boundary. Nothing replaced the lost ability. |

Separately fixed this session: bootstrap `addremove` sweep indexed paths with no DB
owner (legacy plans/*.md) whose external deletion froze every track commit
(`4147dbbea1` reconciliation).

## 2. Layered model (the concept)

Undo/redo is three independent projections that must move together:

| Layer | Owner | Undo action | Redo action |
|-------|-------|-------------|-------------|
| **Files** | fossil leaves | `checkout --force targetLeaf` | `checkout --force anchorLeaf` |
| **Timeline (DB rows)** | `part`/`message` tables | Rows ≥ target stay/become visible; rows < target untouched; compacted rows between target and boundary are **resurrected** (`compacted=0`) | Re-hide exactly the resurrected set; restore the summary row(s) |
| **Visibility mask** | `message.compacted` + summary part | Recomputed from the boundary crossing | Restored from manifest captured at undo time |

Rule: **revert walks true history** (unfiltered); *visibility* is a projection
applied everywhere else (prompt build, TUI). The regression came from collapsing
these two into one query.

## 3. Mechanics

`revert(messageID M)`:

1. Load messages **unfiltered** (`visibleOnly: false`).
2. Collect tail patches as today → `targetHash`, and detect boundary crossing:
   any compacted row or summary part with `id ≥ rev.messageID`.
3. If crossing:
   - Resurrect: `UPDATE message SET compacted=0 WHERE id >= rev.messageID AND compacted=1`
     (bounded by the recorded boundary list, see §5).
   - Remove summary parts/messages above `rev.messageID` via existing Removed events.
   - Store in `session.revert` a **restore manifest**: `{ summaryRow, hiddenIds[] }`
     so redo can invert exactly.
4. `revertTo(targetHash)` as today (file layer).

`unrevert` with a crossing-manifest:

1. Re-hide `manifest.hiddenIds` (`compacted=1`).
2. Re-insert summary row(s) from `manifest.summaryRow`.
3. `checkout(op_id)` files.
4. Keep/pop stack as today.

Non-crossing undo/redo behave exactly as shipped in `0cf33b7030` + `cb630956be`.

## 4. Invariants

- I1: fossil never stores or restores DB state — DB layer owns the timeline.
- I2: no physical deletion during undo; physical delete happens only at the next
  prompt fold (`cleanup`), and never crosses the boundary (fold clamps at boundary).
- I3: `patch.files[]` never scopes restore; `patches[0].hash` remains the sole target.
- I4: every crossing records an invertible manifest BEFORE mutating rows.
- I5: undo row mutations are `session_id`-scoped; forks are deep copies
  (`Session.fork` remaps IDs, zero row sharing) and are never affected.
- I6: the pre-undo state is always recoverable — anchor fossil leaf (redo path),
  later leaves holding manual edits (fossil registers them too), and per-edit
  copies under `.opencode/data/backups`.

## 5. Resolved decisions (Alexander, 2026-08-23)

1. **Stacked compactions:** yes — all boundaries between target and tip fold into
   ONE manifest; one undo restores across all of them, one redo re-applies all.
2. **Manual edits after compaction:** overwriting in the working tree is safe —
   see I6; nothing is lost.
3. **Fork sessions after compaction (detailed):** `Session.fork` deep-copies
   messages/parts into a new session with fresh IDs. Undo mutations are scoped
   `WHERE session_id = parent` → fork rows cannot be touched (I5). A fork taken
   after a compaction copies only the visible window (fork loads via default
   visible-only `messages()`), so the compacted archive never lived in the fork;
   parent-side uncompact must not propagate into it. → v1: no special handling.

## 6. Trials (definition of done)

| # | Scenario | Expected |
|---|----------|----------|
| T1 | chat-only undo/redo (no compact) | unchanged vs `0cf33b7030` behavior |
| T2 | edit-step undo/redo (no compact) | unchanged vs current |
| T3 | compact → undo to pre-compact message | pre-compact window fully visible; summary gone; files at old leaf |
| T4 | T3 then redo | compaction re-applied exactly (same hidden set + summary) |
| T5 | compact ×2 → undo past both boundaries | both manifests folded, single undo restores |
| T6 | T3 then new prompt (fold) | tail deleted physically only ABOVE boundary; compacted history stays intact |
