# Kernel release 2026-09-28 — identity contracts lose gates, gain code-synced tool rows

Plan: `plans/2026-09-28_kernel-identity-tools.md`. Depth: L2 (identity contract shape),
owner-approved; the diff was shown before install.

## What changed

1. `Identity` lost `gates` and `may_mutate` (`model.py`, `source.py`, `render.py`, `validate.py`).
   Gates are a workflow property; an identity contract that lists them (with a two-way validator
   check) said nothing an ACL enforces. The `<spine>` lines in six agent prompts and the
   `(G1–G9)` parentheses in the mode reminders went with it; a guard test keeps them out.
2. Section 5 gained **tool rows** rendered from the new `IDENTITY_ADDONS` registry — one
   `tools:` line per identity (hybrid: `all except …` for wide identities, an explicit list for
   narrow ones; prose after `;` carries path-scoped edit boundaries).
3. The rows are extracted from the live ACL and guarded by a parity test — the pair that makes
   «synced with the real permissions» a mechanism rather than a hope:
   - `packages/opencode/script/kernel-tools-manifest.ts` — manifest from the live rulesets;
   - `packages/opencode/test/agent/kernel-identity-tools.test.ts` — rendered §5 vs live ACL.
4. Two real ACL mismatches were found by the first manifest run and fixed:
   - `jobkill`'s policy is `job_kill` while seven deny lists said `jobkill` — the deny was dead;
     fixed on the deny side (the TUI already keyed on `job_kill`).
   - `Permission.disabled` counted the defaults' scoped `read: { "*.env": "ask" }` as a scoped
     open for a flat deny, reporting `read` available in `reasoning_mode`/`researcher_agent`;
     scoped opens now count only for the edit family, as in `SessionTools.denied`.

## Numbers

- Render: 47 368 B → **48 274 B**, 6 209 → **6 290 tokens**; the byte cap moved 48 000 →
  **49 000** (recorded in `source.py`), the token cap stayed ≤ 7 000 (`test_dedup.py`).
- Oracles: kernel pytest **117 passed**; `bun typecheck` exit 0; parity suite **21/21**
  (`20260928T200926Z_e1542b78`); install `ac3e8d51…`; baseline repinned, `PIN_OK`.
- Dedup: one approved repeat (identity rows genuinely share the transition fragment) —
  `REPEATED_NGRAM_ALLOWLIST` entry with its reason.

## Residuals

- Claude/Codex variants render section 5 without tool rows — their tools are not ours; add
  per-registry rows when those harnesses expose a machine-readable ACL source.
- `bin/opencode.exe` rebuild/rollout remains the owner's procedure (`bin/` untouched).
