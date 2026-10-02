<!-- intention: fossil carries only the BRIEF (which files changed) and codegraph carries the REAL impact (symbols and edges touched) selected by the SUMMARY's own time window; the graph is synced off the turn's critical path -> the turn stops paying 2.2 s for a value its own summary consumes, and an empty impact stops reading as "nothing happened" -->
# Decouple codegraph impact from the turn path

**Status:** ACTIVE — owner, 2026-09-29: «Не смешиваем - fossil нам нужен только чтобы показать краткий бриф изменений, а codegraph покажет реальные» + «нам надо просто убедиться что codegraph засинхронизирован… и сделать выборку по времени на которое попадает наш summary».

## Established by measurement — do not re-derive

- ✓ **The DB carries the times we need** (`experiments/2026-09-29_stall-repro/codegraph_schema.mjs`, read-only):
  `files(path, content_hash, size, language, modified_at, indexed_at, node_count, errors, generated)` — 5 716 rows;
  `nodes(…, updated_at)` — 73 911 rows; `edges` 375 252; DB **444.80 MB**.
- ✓ **Those times are the INDEXER's clock, and the sync works.** Newest stamps are today's edits with a 0–6 s drift from the file's mtime (`processor.ts` mtime 16:53:26 → indexed 16:53:32; `sidebar/*` 16:39:51 → 16:39:54); `nodes.updated_at` max = today 16:53:32Z. Distribution: 134 files indexed within 24 h, 219 within 7 d, of 5 716. ⇒ a sync performed during a turn leaves `indexed_at`/`updated_at` INSIDE that turn's span, which is exactly what makes a time-window selection correct.
- ✓ **The MCP path costs 2.4 s per call** (`codegraph` tool measured through `part.time_created → time_updated`: 2399 ms, of which the SQLite pack reports 186 ms ⇒ ~2.2 s is the MCP touch).
- ✓ **It is called on the turn path**: `snapshot/fossil.ts:694` `mcpTouchThenSqlitePack(...)` on the COMMIT branch (its failure comment records a **180 s** block on 2026-09-18), and `session/summary.ts:457`. So the turn pays for a value the SUMMARY consumes.
- ✓ **In the summary the value is anonymous and often empty**: the row reads `Impact: 8 changed files, 0 callers; top symbols none` — no source name, and `none` is indistinguishable from "nothing ran" (the project's own invariant: absence of an oracle reads as FALSE).
- ✓ **The `sym` tag EXISTS on the live checkouts and its value is EMPTY — measured 2026-09-29** (`fossil info` → `tags: sym, trunk`; `fossil tag list 82eca50b…` and `… 4a9cf39c…` — checkout AND parent — both return **`sym=KINDS:none|TOP:none|XF:0`**). So `readSymTag` yields `totalSymbols: 0`, and `footer.tsx:100` (`if (!tag?.totalSymbols) return null`) renders **no ◆ section at all**: the footer's impact display is dead TODAY, before any rebuild — and **C1 is not the cause**. `--propagate` carried an empty value forward. C5 is therefore not "prevent a regression C1 introduced" but "repair a reader that has been showing nothing", and the empty value shares C3's root: the pack was built over files the graph does not hold.
- ✓ **Two different clocks, and they must not be fused**: `files.modified_at` = when the FILE changed; `files.indexed_at` / `nodes.updated_at` = when the indexer saw it.
- ✓ **The indexer's domain is CODE ONLY — measured, and it kills a time-based selection** (2026-09-29): `typescript` 3174 · `rust` 1695 · `tsx` 562 · `python` 127 · `javascript` 77 · `yaml` 41 · `astro` 14 · `xml` 13 · `c` 7 · `nix` 4 · `lua` 1 · `objc` 1, and **no `markdown` / `cmd` / `mjs`**. A window that edited only `.md`/`.mjs`/`.cmd` has **no rows at all** in `files`.
- ✓ **The graph does update itself, but not in seconds**: `packages/opencode/src/snapshot/fossil.ts` `modified_at` 18:29:20 → `indexed_at` 18:32:36 (**~3 min**), and `files indexed in the last 1 h` = **1**. Against a 20-minute window that lag is inside the window (the granularity doctrine), but C2's acceptance («still FRESH a few seconds later») is NOT met by this measurement and stays open.

## The granularity doctrine (owner, 2026-09-29) — the scale this plan is built to

Owner, verbatim: «Fossil кстати тоже, мы его четко вызываем только для снапшота и он гранулирован началом
хода, и все ну и перед undo чтобы можно было сделать redo. Тулы должны работать сами. Как говорится можно
успеть секунда в секунду - только вопрос - ради чего, средний ход 10 минут, 64к токенов это 20 минут.»

- A turn ≈ **10 minutes**; a 64k-token summary window ≈ **20 minutes**. Every mechanism gets the
  granularity of the scale it serves, and nothing finer.
- **fossil is already right** and is the model to copy: called deliberately for the snapshot, granulated by
  the START OF THE TURN, plus before undo (so redo has a base). Not per command, not per message.
- **codegraph serves the SUMMARY**, so it syncs on the summary cadence — never on the turn's critical path.
- **±10 s against a 20-minute window is noise.** Verifying it is the anti-pattern this plan deletes.
- **«Тулы должны работать сами»** — the runtime must not hand-hold a tool on the critical path; the tool
  maintains itself and is asked only when its ANSWER is needed.

## Tasks

- [x] ✓ **C1 — fossil keeps the brief, and only the brief.** The commit path no longer touches CodeGraph: the `mcpTouchThenSqlitePack` call and BOTH tag writes (`sym` / `sym-missing`) are gone from `track` — **−69 lines, +8**, replaced by a note naming the doctrine. `impact(from, to)` — the ON-DEMAND tool at `:1040-1088` — keeps its call and its import deliberately: it answers a question when asked, which is exactly what the doctrine permits. Oracles: `bun typecheck` → **exit_code 0** `20260929T182925Z_c147d893`; `bun test test/session/snapshot-granularity.test.ts test/session/snapshot-tool-race.test.ts` → **5 pass / 0 fail** `20260929T183059Z_60a660d1`.
  - **Follow-up this task created, and it is C5's:** `lastImpact()` (`:1091+`) now reads a tag nobody writes. The typecheck is what surfaced it — I had concluded "one call site" from a grep that looked for the DEFINITION instead of the USES, which is the filter class this session logged nine times.
- [ ] **C2 — the sync keeps happening; the turn stops waiting for it.** It is NOT to be deleted (it is what makes the times fresh), NOT gated, NOT verified, and NOT made precise — it only has to run somewhere off the turn's critical path: forked (like `Balance.getModelStatus`, `processor.ts:589-601`) or on the summary cadence. Acceptance: the commit path no longer waits on MCP, and a file edited this turn is still FRESH a few seconds later. Measured today: the index stamps itself **0–6 s** after a file's mtime, so a self-update of that order is the whole requirement — «если он сам обновляется 2-3 секунды то вообще не надо дергаться» (owner, 2026-09-29).
- [x] ✗ **C3 — REFUTED BY MEASUREMENT (my premise, 2026-09-29). A time window cannot be the file source.** Instrument: `experiments/2026-09-29_codegraph-window/window_vs_diffs.mjs` + `…/why_zero.mjs`, readonly against the live DB. For the real window #666..#718 (17:39:39→18:11:53, **32.2 min**) both `files.indexed_at` and `nodes.updated_at` inside the window ±10 s return **0 files**, while that window's recorded list holds **4** — so a time selector would have **deleted** the impact, not improved it.
  - **CAUSE, read from the graph itself: the indexer's domain is CODE ONLY.** `typescript` 3174 · `rust` 1695 · `tsx` 562 · `python` 127 · `javascript` 77 · `yaml` 41 · `astro` 14 · `xml` 13 · `c` 7 · `nix` 4 — and **no `markdown`, no `cmd`, no `mjs`**. All four files of that window are **ABSENT from `files` entirely**. Most windows in this project edit plans and experiments, so the time selection is empty by construction; and for windows that DO edit code the fossil-anchor list is already complete (the anchors see the shell-made edits tool metadata cannot).
  - **What survives:** the file list stays the source of `who changed`. The time columns remain useful for **attribution** (which rows moved, C4) — not for selection. Do not re-propose the selection without answering the domain question first.
- [ ] **C4 — three states, attributed.** The summary line names its source and distinguishes: `synced → elements` · `not synced → impact unverified` · `not applicable → no graph files in the window`. Acceptance: the string `top symbols none` can no longer appear as a bare fact.
- [x] ✓ **C5 — the footer's reader, repointed at sources that EXIST.** `snapshot-symtag.ts` no longer decodes the `sym` tag: it reads the **BRIEF** (`fossil info` → `checkout`/`parent`, then `fossil diff --brief`) and the **IMPACT** (`packGraphForFiles` + `packToImpactFields`, readonly SQLite, **no MCP**), returning `changedFiles` + symbols + an `impactUnavailable` flag — so the footer renders a TRUE statement (`N files`, or `N files · impact n/a`) where the ◆ section had been blank while the tag existed. `footer.tsx` renders `N files · fn=5,class=3 (410)`.
  - **A SECOND defect fell out of the regression, and the test caught it on its first run** (6 pass / 1 fail, `expect(info).not.toBeNull()` receiving `null`): `findFossil()` consulted only `process.execPath`-adjacent paths and PATH, so outside the shipped layout — a `bun` test run, a source-run — it could not find the binary at all. A tool that works on PART of its domain is BROKEN, not scoped (@TOOLCHAIN_QUALIFICATION). Fixed by consulting the in-repo locations this project documents (`tools/fossil.exe`, `external/fossil/fossil.exe`).
  - Oracles: `bun test test/tui/snapshot-impact.test.ts` → **7 pass / 0 fail** `20260929T184739Z_4a34e9ec`; `bun typecheck` → **exit_code 0** `20260929T184745Z_2d2b2de9`.
  - **NOT done — the rest of the original C5, and it is bounded:** `lastImpact()` (`fossil.ts:1091+`) still decodes the tag, and its only consumer `test/codegraph/fossil_hybrid_impact_smoke.ts:50-52` still asserts that decode (`fail("Snapshot.lastImpact did not decode the Fossil sym tag")`). Both must be re-pointed in one change, never skipped.

## Smoke Tests

✓ Дополнение 2026-10-02: [план паузы после инструмента](to_be_confirmed/2026-10-02_render-artifacts-and-post-tool-pause.md)
убрал live MCP из per-step `SessionSummary.summarize`, оставив readonly cached impact и live
`enrichRange`. Regression 40/0, typecheck exit 0; это закрывает ожидание MCP после каждого tool,
но C2 остаётся открыт — его отдельная приёмка свежести индекса не измерялась этой работой.

- Baseline (before C1, on the live worktree): one turn that edits a TS file → `SELECT path, indexed_at, modified_at FROM files WHERE path = '<that file>'` is FRESH (drift ≤ 10 s), and `turn.prepare` reports `fossilMs` including the MCP touch.
- After C1/C2: the same turn reports a `fossilMs` WITHOUT the MCP touch, and the file is still FRESH a few seconds later — **the self-update IS the requirement; no gate and no verification step is added**.
- After C3: the summary row for a window that edited TS files carries an attributed impact naming those elements, matched with the ±10 s band. A symbol a few seconds outside the exact boundary appearing (or not) is NOT a failure.
- Negative control (C4): a window with only `.md`/`.cmd` changes must render `not applicable` — NOT `top symbols none`.

## Out of scope

- Nothing under `bin/` (owner's live runtime).
- The MCP server's own internals; this plan treats it as a black box that reports its sync state.
- No change to the 2.4 s cost of a sync itself — only to WHO waits for it.
