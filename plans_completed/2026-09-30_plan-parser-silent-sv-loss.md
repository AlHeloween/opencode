<!-- intention: the plan reader drops a box's sv tag without a word when the box has no bold ID, and MASTER_PLAN.md has two writers -> every tag written on a box is either read or reported as unreadable, and the map has exactly one writer -->
<!-- goal_sv: plan-parser, silent-loss, sv-tag, single-writer, master-plan -->
# Plan reader: silent sv-tag loss, and the map's second writer

```yaml
Keywords: plan-parser 0.30, silent-loss 0.25, sv-tag 0.20, single-writer 0.15, master-plan 0.10
Semantic dominant: The component that closes the loop must not lose a box's vector silently, and the map must have one writer.
md5: 71c3e9a05b2f48d6e0a7c1b9f3d52e68
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

**Status:** COMPLETE 2026-09-30. Handoff from the cua/installer session to the owner of `util/plan-status.ts` and of
the map renderer; taken up by that owner and closed here.

## Findings — as reported, then re-grounded before any fix

1. **Tags on a box without a bold ID were dropped silently.** `plan-status.ts:264` handed such a box an empty
   string — `parseTaskTags(structured ? after : "")` — so its `<!-- sv: … | done_pct | attempts | last_failure -->`
   was never looked at and nothing said so. CONFIRMED by measurement, not by reading alone → P1.
2. **An id with a hyphen was truncated — and the damage was worse than reported.** The old class stopped at the
   hyphen, so `**S-A …**` read as `S` **and `**TASK-6 …**` read as `TASK`**: every `TASK-N` box in one plan
   collapsed onto ONE name. Measured, `Received: "TASK"`. That is fatal to a manifest, whose key IS the id and
   would never resolve — and it is invisible on the map, because two colliding boxes render as two identical ids.
3. **"MASTER_PLAN.md has two writers" — REFUTED as a race, and what replaced it was already true.** `svm.ts:389-413`
   reads the hand-owned head, refuses to write without `RENDER_MARKER`, and replaces everything below it. There is
   no unpoliced second writer: the head belongs to the owner, the body to the renderer, one writer per zone. What
   survived of this finding is narrower — a hand line in the BODY is removed SILENTLY rather than named — and P3
   measures the removal rather than asserting it. Naming it is a refinement, not a defect: no consumer reads the
   map expecting a hand line to survive.

## Why it lasted: both defects were LATENT on the live tree

Measured on 2026-09-30, before the fix: the only structured box carrying a hyphenated id
(`plans/2026-09-26_unified-settings-layers.md`, `T5-live`) is `[x]`, and the map renders OPEN boxes only — so no
rendered id changed; and **no** unstructured box anywhere in `plans/` carried a tag. The two incidents named in the
original finding were worked around by RE-FORMATTING the plans to fit the reader (`1250937fb0`, `SA…SF`): the
author adapted to the tool's blind spot instead of the tool being fixed. That is the cost this close removes — a
trap that silently punishes a legitimate formatting choice, and reports the punishment as `sv MISSING` on the box.

## Smoke Tests

- [x] ✓ **P1 red, measured before the fix.** `bun test test/util/plan-status.test.ts` →
  **19 pass / 4 fail** (`20260930T084553Z_d3145fa7`), and the four failures sit ON THE ASSERTIONS, not on the
  harness: `sv` `[]` where `["alpha","beta"]` was written; the same for the same box's bookkeeping fields;
  `Received: "S"` where `S-A` was written; `Received: "TASK"` where `TASK-6` was written. The predicted
  `19/4` was stated before the run. The fifth new case — an em-dash header — was green then and stays green.
- [x] ✓ **P2 green, and nothing else moved.** `bun test test/util/plan-status.test.ts test/tool/plan-status.test.ts`
  → **25 pass / 0 fail** (`20260930T084644Z_bd8c7945`); the renderer's own suite `test/session/svm.test.ts` →
  **9 pass / 0 fail** (`20260930T084654Z_2bdea610`); `bun typecheck` → **exit 0** (`20260930T084704Z_191b60b6`).
  The fix: an id is a leading run that STARTS alphanumeric and may contain `-` (`[A-Za-z0-9][A-Za-z0-9_-]*`), the
  title is what follows once the separator (whitespace, em/en dash, or a run of them) is stripped, and tags are
  read from the WHOLE box line — which also fixes space-only headers (`**S1 author:**`) whose title the old
  `\s*[—-]\s*` could not separate.
- [x] ✓ **P3 single writer, MEASURED not argued.** A hand line was inserted into the body of `plans/MASTER_PLAN.md`
  and the map re-rendered: the line is GONE (`git grep` finds no `HAND-EDITED-2026-09-30`), the file returned
  **byte-identical** (`git status` clean against HEAD, `git diff --stat` empty), and two consecutive renders both
  produced **26188 bytes**. So the render both removes a hand line and is idempotent — the two clauses of this
  box, each observed rather than inferred from `svm.ts:413`.
