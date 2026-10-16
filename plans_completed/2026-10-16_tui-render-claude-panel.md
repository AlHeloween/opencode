<!-- intention: opencode TUI Agent Configuration dialog renders as staircase in Claude Desktop Terminal panel (TERM=xterm-256color, TERM_PROGRAM=claude-desktop) while owner's own terminal renders fine -> rows aligned in the panel, badges kept as information -->
<!-- goal_sv:
Keywords: tui-staircase 0.30, emoji-width 0.25, opentui-renderer 0.20, claude-panel 0.15, badge-glyphs 0.10
Semantic dominant: Agent dialog rows align in the Claude Desktop panel with badge information intact.
md5: 75a1b2c3d4e5f60718293a4b5c6d7e8f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t75 — opencode TUI renders as a «staircase» in the Claude Desktop Terminal panel (2026-10-16)

## Goal

The Agent Configuration dialog (scope: worktree) drifts LEFT ~1 cell per badge row in the owner's Claude Desktop
Terminal panel and the lower part is cut off, while the same TUI in the owner's own terminal renders correctly
(owner: «Все отлично запустилось»).

Fix at the root — width table / VS16 emit / absolute positioning — not by stripping the badges (`↓0.1 ↑0.2 ↻0.002`
+ `[🎥👁🧠🔧]` are information). GREEN = rows aligned in a headless harness AND unchanged output in a standard
terminal model.

## Grounding (G1)

- Badge source: `packages/opencode/src/cli/cmd/tui/component/model-cost.ts:90-96` `capabilityGlyphs()` pushes
  `🎥 U+1F3A5`, `👁 U+1F441` (NO VS16 U+FE0F appended), `🧠 U+1F9E0`, `🔧 U+1F527` as `[glyphs.join(" ")]`; cost chip
  `compactCostLabel()` (`⇣ U+21E3`, `⇡ U+21E1`, `↻ U+21BB`) at `model-cost.ts:74-81`.
- Row assembly: `agent-model-cell.ts:79-103` `agentRowModelCell()` → `description` (name + provider), `footer`
  (price + caps + variant); `dialog-agent.tsx:232-239` puts it on every agent row, so EVERY primary/subagent row
  carries the badge line. Panel: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=claude-desktop`
  (embedded xterm.js-class behind ConPTY — owner's screenshot described by Claude).
- JS width: `packages/opentui/packages/core/src/platform/runtime.ts:40`
  `stringWidth = Bun.stringWidth ?? string-width`; dialog truncation/padding goes through it.
- Native width: `packages/opentui/packages/native/src/utf8.zig:418-520` `eawToWidth()` — explicit wide ranges +
  `return 1` fallback. Prime suspect measured by READING (not yet by oracle): `👁 U+1F441` falls in the gap
  between `1F400-1F43E`, single `1F440`, and `1F442-1F4FC` → returns **1**, while xterm.js-class terminals render
  emoji `👁` as **2** (Emoji_Presentation=No but emoji-capable terminals widen it; with VS16 it is 2 everywhere).
  Neighbours check by reading: `🎥 U+1F3A5` in `1F3A0-1F3CA` → 2 ✓; `🧠 U+1F9E0` in `1F947-1FA53` → 2 ✓;
  `🔧 U+1F527` in `1F4FF-1F6C5` → 2 ✓; `⇣/⇡/↻/◉` not in wide lists → 1 (expected 1).
- Emit: `packages/opentui/packages/native/src/renderer.zig:2568,2596-2600` — absolute CUP per run
  (`moveToOutput(x+1, y+1)`), and after a grapheme re-CUPs to `nextX+1` ONLY when
  `caps.explicit_cursor_positioning` (tmux/screen/alacritty/kitty-graphics paths in `terminal.zig:701-818`;
  `claude-desktop` matches NONE → flag OFF, default `caps.unicode=.unicode` at `terminal.zig:18`). So inside one
  row the bytes after a mismatched glyph are placed by terminal advance, not by CUP — intra-row shift; the
  row-to-row staircase needs the overflow/wrap or ConPTY re-encode leg, still open (alternatives: ConPTY
  re-encoding, missing synchronized-output/DECAWM assumption, panel resize race — rule out in S1).
- No `@xterm/headless` in the repo (grep: only log noise + unrelated `strip-ansi` keyword); a new npm dependency
  goes through the catalog rule — harness first tries zero-dependency widths (native `eawToWidth` vs JS
  `stringWidth` vs Unicode Emoji data), headless only if the catalog allows.
- Skills: `.opencode/skills/opentui/references/**` (core/api, components, testing/REFERENCE.md) — read before
  touching renderer/dialog code.

## Decision — which fix and why

1. First measure (S1): per-glyph width table on three sides — native `eawToWidth`, JS `stringWidth`
   (+ `Bun.stringWidth` when present), terminal reference (Unicode `Emoji_Presentation` + `East_Asian_Width`;
   xterm.js `unicode11` behaviour via researcher probe, ConPTY behaviour if reachable). The staircase predicts a
   systematic -1 per badge row on exactly the glyphs the panel widens.
2. Then fix at ONE root (S3): either widen the native table entry (e.g. `U+1F441 → 2`, audit neighbours
   `U+1F442-gap`, `U+200D` handling already 0), or emit `👁︎` with VS16 (`U+1F441 U+FE0F`, zero-width per
   `utf8.zig:435`) so both sides agree on 2 — whichever the table proves; never strip badges.
3. Rejected: removing badges/caps (destroys information the owner asked to keep); per-terminal hacks keyed on
   `TERM_PROGRAM=claude-desktop` (a second spelling of one width truth — compensation on top of a defect).

## Tasks

- [x] S1-measure <!-- sv: width-table-measure,glyph-oracle,conpty-alternatives -->
  DONE 2026-10-16: researcher external leg (unicode.org CONFIRMED: eye EAW Neutral/EP No/Age V7; xterm.js default-6 vs unicode11 GUESSED; ConPTY passthrough CONFIRMED; sync-output excluded, DECAWM sign wrong, resize-race excluded if stable) + local leg run 20261016T115903Z_2a9aa77f exit 0 (eye-plain Bun 1/lib 2, eye-vs16 Bun 2/lib 2, all other badge glyphs agree; native eawToWidth eye=1 by table gap, VS16 cluster=2 by promotion rule utf8.zig:643-649).
  Researcher probe: native vs JS vs terminal widths for `🎥 👁 🧠 🔧 ⇣ ⇡ ↻ ◉` + VS16 variant; rule out ConPTY
  re-encode / DECAWM-sync / resize-race with receipts. Receipt: width table in the plan + probe run ids.
- [x] S2-red <!-- sv: headless-harness,staircase-red,dialog-rows -->
  DONE 2026-10-16: test/tui/badge-width.test.ts RED run 20261016T120309Z_143126b4 exit 1 (no VS16 in glyphs; panel-model 25 > laid-out 24 per badge row). No new dependency (zero-dep panel model; @xterm/headless absent from repo).
  Harness (no new dep unless catalog-cleared) feeds the dialog's footer strings through the buffer/renderer width
  path and asserts first-glyph column per row. Receipt: RED run id + failing assertion (row N starts at col M≠1).
- [x] S3-fix <!-- sv: width-table-fix,vs16-emit,absolute-positioning -->
  DONE 2026-10-16: ONE root fix — capabilityGlyphs emits U+1F441 U+FE0F (model-cost.ts); doc comments updated (model-cost.ts, agent-model-cell.ts); existing expectations moved in the same change (model-cost.test.ts, agent-model-cell.test.ts). Badges kept, no per-terminal hack.
  One root fix (table and/or VS16 emit; absolute CUP only if the probe proves the emit leg). Receipt: diff + paths.
- [x] S4-green <!-- sv: rows-aligned,regression-standard-terminal -->
  DONE 2026-10-16: badge-width 3/3 GREEN run 20261016T120857Z_dee192cb exit 0; model-cost 11/11 run 20261016T120915Z_37b973c0; agent-model-cell 24/24 run 20261016T120931Z_4a74207a. Post-fix badge counts 13 on all sides (was 12 ours vs 13 panel).
  Same harness GREEN (rows aligned) + standard-terminal model output unchanged (no regression). Receipt: GREEN run
  ids; a red test is first a question about the TEST (AGENTS.md § Bug Policy) — never weaken it.
- [x] S5-close <!-- sv: docs-progress-commit,build-smoke,private-index -->
  DONE 2026-10-16: _progress_log.md appended (t75 entry); commit e6cb9962 via scripts/commit_own.py (7 own paths only); _build.ps1 exit 0 run 20261016T121202Z_c76d4cd8, smoke 10.0.1409.
  `_progress_log.md` append (BOTH on conflict), commits of ONLY own paths via `scripts/commit_own.py`, final
  `pwsh -NoProfile -File _build.ps1` via cmd_runner + `state.json` read. Receipt: commit hashes + build run id.

## Claims

- C1: `👁 U+1F441` width disagreement (native 1 vs panel 2) drives the per-badge-row drift. Falsifier: S1 table
  shows all three sides agree on `👁` (then the overflow/ConPTY/resize leg is the cause and S3 re-targets —
  G8→G2, no fix on a refuted premise).
- C2: the fix aligns rows in the harness without changing standard-terminal output. Falsifier: S4 GREEN fails on
  either leg.

## Risks

- R1 (ConPTY re-encode): the panel may not be xterm.js widths at all — contained by S1 explicitly probing the
  ConPTY leg before S3; no fix lands on the width premise alone.
- R2 (shared tree): two other robots in this tree — commit ONLY own paths via `scripts/commit_own.py --session`,
  never `git add -A`; `index.lock` → wait 5 s and retry.
- R3 (secrets): never read/print env VALUES (names only).

## Smoke Tests

- Baseline (S2 RED): harness prints per-row start columns; at least one badge row starts ≠ column 1.
- Post-change (S4 GREEN): all rows start at column 1; reference-terminal rendering byte-identical to baseline.
- Regression: nearest existing suites by path (ONE file per `cmd_runner` call from `packages/opencode`):
  `test/` model-cost/agent-cell area if present, plus the opentui width-adjacent test owning the touched table.

## Bounds

steps 60, tools 160, loops 3, depth 2, time 5 400 000 ms. Work in `D:/zPython/opencode`, branch
`Local_Development` (no checkout, no worktree). No `bin/`, no kernel, no `--no-verify`.
