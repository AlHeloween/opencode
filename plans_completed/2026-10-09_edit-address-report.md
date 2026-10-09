<!-- intention: after a successful `edit`, the RESULT itself carries the fresh addresses (written region + every label that moved), so continuing to edit needs no re-read; a Python indentation slip becomes visible in the echo and fixable in ONE edit. -->
# 2026-10-09 — `edit`: the result becomes an address source (echo + fresh tail labels)

Owner, 2026-10-09, verbatim, in order:
1. «Смотри у нас тут баг в edit для редактирования питона… Что реально можно сделать?»
2. «после edit - надо возвращать номера строк и изменившиеся хеши, если мы еще этого не делаем иначе придется постоянно перечитывать.»
3. «Честно дядька попасть в питоновские отступы еще та морока - надо что-то придумать.»
4. «С обычным кодом - не питоновым валит супер, только если хеши изменившиеся возвращали то было бы еще более супер, а вот с отступами питона реально надо что-то делать.»

## Grounded (measured, not recalled)

Source: `D:\zPython\universal-search\.opencode\data\opencode.db`, session `ses_ffcc3e312ffeHHGhbwRi9rvkfc`; edit tool source read in the tree.

- ✓ **The two failure classes, both with the tool behaving as specified:**
  - *Stale/fabricated addresses.* Two failed calls: `prt_11e9e9892001ioQML5n9ZKzCC6` (03:04:32) and `prt_11ea0725e001wVdt5axXKQsBol` (03:06:33), each `fromHash is not in this file`. Of the 7 labels used: 1 real (fresh read), 1 is the 8-hex prefix of an `evidence_ref` (`ev_efcbed4b…` from an unrelated grep at `prt_11e97fd95001TXEwlQqn9rYcsh`), **5 appear nowhere in the session** — fabricated by the model. Refusals were correct; the model had no cheap way to get current labels — after its own write, every label below the change moves.
  - *The Python slip.* `prt_11e9fc1f1001hEvPeypjnBtkK0` (03:05:48): `fromHash` named line 154 (`    with _record_http_time() as start_time:`); `newString`'s FIRST line lost its 4-space indent (`if method == "get" and wants_chrome(url):` at column 0) while the rest was absolute-correct. The tool wrote it literally (per contract), returned «Edit applied successfully» + 13 LSP errors incl. `Parse error: unindent does not match any outer indentation level`. The agent rolled back (`prt_11e9fda35001`, `Copy-Item .orig`) and built a `py_compile`-guarded patch script — the rule-forbidden path — because fixing in place required a re-read it did not have.
- ✓ `plans_completed/2026-10-01_hash-addressed-edits.md` §"Why this ends the plague" made re-reading **mandatory by construction** («вопрос перечитай теперь обязательный. Потому что не зная хеша - не отредактируешь»). This plan is the owner's amendment, not a reversal: addresses must still come only from **a runtime output computed over the actual file** — `read` today; `edit`'s own result becomes the second such source. «I think the file says…» still has no path to a write; a fabricated hash still resolves to nothing.
- ✓ Tool returned NO addresses before this change: `edit.ts` output builder — `Edit applied successfully.` + notices + LSP blocks only (measured in the same DB: every edit result in that session, e.g. `prt_11e9f8103001wDwJ6Sgy2S4QYn`).

## Design decisions (and the dropped alternatives)

1. **The address report is emitted per file, after the LSP block** (the result closes with the new state, read's pager style):
   - **ECHO** — the written region(s) ± 2 lines of context, in `read`'s exact `N  hash: text` shape (labels over the POST-write text; copied directly into the next call).
   - **MAP** — labels only (`N  hash`) for every line whose label MOVED: `firstDiff..EOF` (the chain runs over the whole prefix, so a change at line K moves every label from K to EOF; labels above are unchanged and are not repeated).
   - One byte budget (`ADDRESS_REPORT_BUDGET = 8 * 1024` for the whole block, per file); a cut is NAMED, read-pager style: the footer says which lines are not shown and that their addresses moved — no silent truncation.
   - If the **formatter** rewrote anything (`contentFinal !== contentNew`), the echo falls back to one `firstDiff..lastDiff` window — per-span positions cannot be trusted after a whole-file rewrite; the map is unaffected (computed from the final text).
   - `content` (file creation): the echo IS the whole file (it has no unchanged region), bounded by the same budget; no separate map.
   - Deletions/all-empty result: named in one line (`the file is now empty`); a deletion echoes its seam.
2. **Post-application span ranges** come from the resolve step: walk the clash-checked spans ASCENDING with a running `shift` (deltas of lower spans), `newStart = start + shift`, `newEnd = newStart + fittedLen - 1`. `Resolution`'s `"text"` variant gains `spans` (additive — existing callers read `.text`).
3. **Python indentation: NO auto-reindent, NO heuristic refusal.** Uniform re-basing cannot repair the observed fragment (its internal structure was inconsistent: first line relative, the rest absolute); auto-fix and "does it look wrong" guards are the guess-and-silently-land class this tool removed on 2026-10-01. The mechanism built now: the echo makes the slip **visible instantly**, the map makes the fix **one edit** — the loop LSP already detects is closed inside the tool. The description gains the explicit rule (newString is literal column-for-column; the first line is not aligned to the line it replaces).
4. Exact same primitives as `read`: `chainHash`/`hashLabel` (`read.ts:488-501`), `terminated()` (`edit.ts:173`) — ONE spelling of the address, pinned by a test that a subsequent `edit` ACCEPTS the returned labels (the acceptance oracle).

## Tasks

- [x] ✓ **A1 — address report in `edit.ts`.** `AppliedSpan` added to `Resolution`; `addressReport()` (echo + map + budget + named cut, formatter fallback, created/deleted cases) exported; wired into the output builder. Evidence: the change itself, `edit.ts`; exercised by the suites below (58/0).
- [x] ✓ **A2 — `edit.txt`.** §After the write names the report (echo, moved labels, no re-read, cut footer); the entry rule states literalness (`newString` column-for-column; the first line is NOT re-indented; a Python slip is visible at once). Evidence: the file; both `Parameters` description cases still green.
- [x] ✓ **A3 — tests.** `edit-exact.test.ts`: 8 unit cases (echo+map labels === the final chain; acceptance — the printed label resolves in `resolveEdits`; first-moved boundary; CRLF≡LF and no `\r`; named cut; created file; deletion seam; all-deleted). `edit.test.ts`: 2 live cases through the real layers — **acceptance: a second edit addressed ONLY from the first result (no read) applies**, and the measured Python slip — the echo shows the column-0 line verbatim and the echoed label repairs it in one more edit. Plus 1 assertion added to the existing R1 refusal test: a refusal message carries no addresses block. Red-before: the new tests reference `addressReport`, absent at HEAD (`git show HEAD:...edit.ts`), and the pre-change baseline run pinned 48 pass — the same suites now run 58. Evidence: runs `20261009T032352Z_ce18a01f` (baseline 48/0) → `20261009T032839Z_903b11e6` (58/0, 122 expects).
- [x] ✓ **A4 — oracle.** `bun test test/tool/edit-exact.test.ts test/tool/edit.test.ts` — 58 pass / 0 fail, exit 0 (`20261009T032839Z_903b11e6`); `bun typecheck` (`tsgo --noEmit`) exit 0 (`20261009T032743Z_4c527689`); `pwsh _build.ps1` — «Build complete - artifacts in dist/», smoke `10.0.1254` (`20261009T033507Z_c1f8bf93`). The first build attempt failed BEFORE this (see Deviation) — fixed and re-run green twice.

## Smoke Tests

Baseline FIRST (pre-change, pinned): both suites green — **48 pass / 0 fail** (`20261009T032352Z_ce18a01f`).
1. **Echo + moved labels, red→green** — unit: `expect(out).toContain("3  <label-of-final-line-3>: NEW")` and the bare `N  hash` map lines for the tail; FAILS at HEAD (no `addressReport` at all), passes now. ✓
2. **The acceptance loop (the owner's ask)** — live: edit #1 → the label for the moved line is taken from the RESULT text → edit #2 uses it, no `read` in between → applied. Was a refusal class before (`address drifted`); now applies. ✓
3. **Python regression** — live: the incident's exact shape (a block whose first line is at column 0) → the echo shows `N  <hash>: if x:` verbatim; the echoed label repairs it in one more edit. No LSP assertion (a Python server may be absent in the test env — the tool mechanics do not depend on it). ✓
4. **Budget** — unit: a 40-line file with a 220-byte budget → the footer names the uncovered range (`read` from offset …). ✓
5. **No report on refusal** — assertion added to the existing R1 live test: the refusal message carries no `Addresses for`. ✓ (refusals throw before any output exists — pinned so it stays true).

## Deviation / Kaizen (2026-10-09) — `_build.ps1`

The mandated build failed its FIRST attempt (`20261009T032919Z_a1bc1fe5`, exit 1) AFTER the candidate was built and smoke-passed: `Copy-Item` of markdownify into `dist\bin` died with «Could not find a part of the path». Class: **an unguarded copy into `$DistDir\bin`, a directory owned by a branch that can be skipped** — the opentui and artifacts_dist copies carry a guard, the markdownify copy did not, and when the native-binary branch did not run the dir was never created. Re-run as-is was green (`20261009T033209Z_8dd2ec34`), so the trigger is state/order-sensitive (a concurrent actor's build was alive in this workspace — several runs in the same minutes are not this session's). Per @KAIZEN (first occurrence: repair now, name the class): ONE guard hoisted to the start of «Collect artifacts» — `dist\bin` is ensured before ANY copy into it — parse-checked (`PARSE OK`), then the script re-ran green (`20261009T033507Z_c1f8bf93`).

## Risks

- **Result size per edit.** Bounded by one constant + named cut; the cut case is a test. ✓
- **`Resolution` shape change.** Additive field; consumers re-checked via codegraph before the edit (registry/run.ts/tests import `EditTool`/`Parameters`; only the two edit suites reach `resolveEdits`). ✓
- **Tool description is prompt-adjacent.** `edit.txt` text enters the tool catalog (stable prefix): old sessions keep the old text until compact — accepted, same class as any tool-description change (`@KV_CACHE_STABILITY`).
- **Label divergence between report and accept-path.** Pinned by construction (same functions) AND by the acceptance smokes — the report's labels are ACCEPTED by the next `edit`. ✓

## Residual (named, owner's call — not built now)

- **Syntax gate on write** (what the agent's `py_compile` script gave it): refuse/revert a write that introduces NEW parse errors, when an LSP server answers for the file. Tradeoffs measured in this grounding: the post-write diagnostic fetch is deliberately bounded/advisory (`edit.ts` DIAGNOSTICS_BUDGET comment) and gating on it inverts that decision; "parse error" is server-flavoured to detect; legitimately-broken intermediate states would be blocked. Propose to the owner with these three costs named.
- Very long single lines in the echo: line-atomic budget cut for now (no wrapping); revisit only if it bites.
