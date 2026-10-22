<!-- intention: tui-commands-violate-surface-standards -> all-dialogs-bound-to-ui-standards-clauses-with-capture-evidence -->
<!-- workflow: lifecycle ACTIVE -->
<!-- goal_sv: Keywords: tui-standards-fixes 0.30, poka-yoke-pickers 0.25, capture-oracle 0.20, confirm-destructive 0.15, discoverable-hints 0.10
Semantic dominant: Turn the t121 audit FAILs into bound fixes — pickers over free text, confirmed destructives, discoverable hints — each proven by a live capture.
md5: 7d1e9f2a4b5c48d6a0f3e5c7a9b1d4e2
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
-->
<!-- subgoal: s3-surfaces-agent-sees-drives — proposed subgoal awaiting the owner's decision; see experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §S3 -->
# t121 — TUI surface-standards fixes (from audit REPORT)

Owner trigger (2026-10-21, verbatim): «Что за... Проверить все комманды TUI на
соостветстие стандартам.» over the Global recents dialog (agent dialog → ctrl+alt+r).

Audit: `experiments/2026-10-21_tui-standards-audit/REPORT.md` — 14 FAILs in 6 kinds,
5 dialogs live-captured (build `20261021T060638Z_f3fcb0b5`, run `20261021T060821Z_7ee0b7e8`,
secrets stripped: `GITHUB_PAT_TOKEN`, `HF_TOKEN`, `NOVITA_API_KEY`).
Root cause of the flagged dialog: the empty field truthfully renders an empty `globalRecents`
allowlist (`local.tsx:195` → `1092-1103` → `dialog-agent.tsx:352` → `dialog-prompt.tsx:86-87`);
the FAILs are the missing semantics around it, not the value path.

No product code changes in THIS task — fixes land box by box, each with its capture oracle.

## Boxes (one per FAIL kind)

- [ ] A — pickers over free text: Global recents becomes a checklist over the catalogue
  (DialogModel options as source; hand-typed `provider/model` validated against the catalogue
  at edit, typo refused with the catalogue row named); model-parameter numbers and settings
  number rows keep free text but validate with a NAMED error toast (no silent reopen, no NaN
  write). Reuse the MCP-add `ask` pattern (`dialog-mcp-add.tsx:47-56`). Fails: A1–A4.
  std: `docs/ui-standards.md` Ergonomics E7 (poka-yoke) + ISO I6 (use-error robustness).
  <!-- sv: picker-over-freetext, catalogue-validated, named-errors -->

- [ ] B — discoverable hints: Global recents footer names the newline keys
  (`shift+return/ctrl+return/alt+return/ctrl+j` per `config/keybinds.ts:80`); DialogPrompt footer
  adds `esc cancel`; palette fuzzy match fixed so `agents` finds `Switch agent` (or an explicit
  `slash:` alias). Fails: B1–B3.
  std: `docs/ui-standards.md` TUI T3 (100% keyboard, Esc cancel) + Ergonomics E6 (standard
  shortcuts) + ISO I2/I4 (self-descriptiveness, learnability).
  <!-- sv: discoverable-hints, newline-keys, fuzzy-match -->

- [ ] C — Esc out of busy: busy DialogPrompt (OAuth/browser wait) gets a cancel path (Esc resolves
  null like the idle path; the MCP-auth wait aborts its poll). ESC from Global recents returns to
  /agents (replace, not clear). Fails: C1 + ESC-navigation note.
  std: `docs/ui-standards.md` TUI T3 (Esc cancel) + ISO I5 (controllability).
  <!-- sv: esc-from-busy, cancel-poll, back-not-home -->

- [ ] D — confirmed destructives: `/cleanup` (N child sessions) and `/unshare` (published link)
  go through DialogConfirm (reuse `DialogConfirm.show` + the settings global-write ESC-safe push
  pattern `dialog-settings.tsx:200-231`). Fails: D1–D2.
  std: `docs/ui-standards.md` Ergonomics E7 (destructive confirmed).
  <!-- sv: confirmed-destructives, cleanup-confirm, unshare-confirm -->

- [ ] E — title/width: Global recents title shortened to fit the 48-cell budget at medium width
  (`ui/dialog-select.tsx:245-246`) — e.g. `Global recents — one provider/model per line`; no
  wrapped title ships without a capture proving it fits. Fails: E1.
  std: `docs/ui-standards.md` Ergonomics E5 (type ergonomics, no mid-word cuts) + ISO I2.
  <!-- sv: title-budget, no-wrap, capture-proof -->

- [ ] F — keybind + empty-state honesty: resolve the `ctrl+g` shadow (dialog-local vs global
  first-message) and document the `ctrl+d` triple binding in DialogHelp; empty `globalRecents`
  states `legacy — no gate` in the dialog and offers an explicit savable empty (return to legacy).
  Catalogue-membership check at edit (F4) is covered by box A. Fails: F1–F3.
  std: `docs/ui-standards.md` Ergonomics E6 (consistent placement, standard shortcuts) + ISO
  I2/I3 (self-descriptiveness, conformity with expectations).
  <!-- sv: keybind-honesty, empty-means-legacy, help-documents -->

## Smoke Tests

- A oracle: live capture of Global recents re-driven as in t121 (slash `/agents` → ENTER →
  `ESC,ctrl+r` bytes `1b12`): catalogue rows checkable, a typo'd `nope/nothing` refused with the
  catalogue row named; parameter dialog fed `abc` → named toast, no silent reopen; settings number
  row fed `abc` → named toast, no NaN write. Predicted: all three refuse loudly; recents saves.
- B oracle: same drive; footer shows newline keys + `esc cancel`; palette filter `agents` lists
  `Switch agent` first. Predicted: no `No results found` for the exact feature name.
- C oracle: MCP-auth busy prompt + ESC → dialog resolves null, poll aborted (log receipt);
  Global recents ESC → /agents, not home. Predicted: both return, nothing hangs.
- D oracle: `/cleanup` with 1 disposable child session → confirm dialog captured; confirm → deleted,
  cancel → kept. `/unshare` on a shared session → confirm captured. Predicted: no toast-only delete.
- E oracle: Global recents capture at 120×40 and at 80×24: title on one line, no merges with the
  placeholder. Predicted: single-line title both sizes.
- F oracle: `ctrl+g` in /agents vs in transcript captured; DialogHelp names the `ctrl+d` contexts;
  recents dialog on empty config states `legacy — no gate` and offers save-empty. Predicted: no
  shadowed key without a help line; empty state explicit.
- Regression guard: `_build.ps1` exit 0 + the t121 capture drive repeated (home → palette →
  /agents → recents → model picker) with unchanged predictions. A case with no prediction runs as
  diagnostic only, never as evidence (@SMOKE_BEFORE).
