# t137 — the edit map names only the lines still in the model's window: wire the caller

<!-- intention: the edit tool already filters its old-to-new label map by a windowLabels set, but no production caller passes one, so the map lists every moved label instead of only those still in the model's window -> the session runtime supplies that set from its own replay selection, read-only, and the plan that left this piece unboxed is finished -->

<!-- goal_sv:
```yaml
Keywords: window-labels-caller 0.35, edit-label-remap 0.25, replay-selection-read-only 0.20, plan-finished-not-parked 0.12, kv-cache-safe 0.08
Semantic dominant: The edit tool already filters its old-to-new label map by a windowLabels set, but no production caller passes one, so the map lists every moved label instead of only those still in the model's window; the session runtime supplies that set from its own replay selection, read-only, and the plan that left this piece unboxed is finished.
md5: 9a4e1c7f3b6d28e05c9a4f1e7d3b6a52
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 5d7c1a9e3f2b4860a1d4c7e9f0b2d4a6
note: hash values are generative tags — search them, never compute them.
```
-->

<!-- workflow: lifecycle ACTIVE -->

- **plan_id:** 2026-10-22_edit-window-label-caller
- **revision:** 1
- **state:** ACTIVE
- **parent plan:** `plans_completed/2026-10-20_edit-label-remap-slice-2.md` — its R1 names the missing piece («a caller-owned window-label set; owner: the session/message-v2 replay selection») and shipped WITHOUT a box for it. This plan is that box; the completed plan is not reopened (its boxes are earned and its outcome is closed).
- **owner, 2026-10-21, verbatim:** «Нет - не все - просто дать список строк файла которые изменились, но есть в контентном окне. Так как мы и задумывали. Только в списке еще написать было -> стало, трансформер это учтет на лету.» and «Ты че если мы все окно будем править то кэш сломается.» — the window is the model's CONTENT window, the map stays `old -> new`, and nothing rewrites the window.

```yaml
Keywords: window-labels-caller 0.35, edit-label-remap 0.25, replay-selection-read-only 0.20, plan-finished-not-parked 0.12, kv-cache-safe 0.08
Semantic dominant: The session runtime hands the edit tool the set of a file's labels that are still in the model's window, computed from its own replay selection, so the old-to-new map names only what the model can still see.
md5: 7c4e2a91d6b83f05e7a2c4b9d1f6083
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 5d7c1a9e3f2b4860a1d4c7e9f0b2d4a6
note: hash values are generative tags — search them, never compute them.
```

## Reuse — why nothing new is built

- The MAP is already shipped (t123): `packages/opencode/src/tool/edit.ts` — `addressReport` takes `windowLabels?: ReadonlySet<string>` (`:402`) and filters the old→new rows by it (`:512`), with a note naming the skipped range and the `read` offset that recovers it (`:531-536`). This plan supplies the set; it does not touch the map's shape.
- The WINDOW is already decided, in ONE place: `packages/opencode/src/session/message-v2.ts` — the per-part wire decision (`:1756-1823`: cleared marker / released placeholder / `kept` rows / folded placeholder / truncated) and the span-expiry gate `releaseExpiredParts` (`:1412`). The set is read from THAT decision, extracted as `replayedToolOutput` so the renderer and the window ask the same question — two implementations of «is this result still in the window» would drift, and the drift is invisible (the map would name lines the model cannot see).
- The LINE SELECTOR is already one: `MessageV2.addressableLines` (`:1159`) parses a stored `read` result's rows (`<n>  <8hex>: `) and drops the scaffold. The window reads labels through it, not through a second regex dialect.
- The CALLER seam is already there: `Tool.Context.extra` (the per-call bag every tool already reads — `ctx.extra?.["model"]`, `ctx.extra?.promptOps`) and `SessionTools.resolve`'s live message accessor (`session/tools.ts:203` → `prompt.ts:2048 liveMessages`).

## Evidence (each line carries its instrument)

- ✓ `grep windowLabels` over `packages/opencode/src` → **3 hits, all in `edit.ts`** (`:389` comment, `:402` parameter, `:512` use). No production caller exists.
- ✓ `read edit.ts` (979 lines, whole): the map and its filter are t123's; the `addressReport` call site (`:920-928`) passes no `windowLabels`.
- ✓ `read tool/tool.ts:16-27`: `Tool.Context` carries `messages: MessageV2.WithParts[]` — the tool's own view of the replayed history.
- ✓ `read session/tools.ts:195-229`: the `context()` builder is the single producer of every `Tool.Context`; `messages: typeof input.messages === "function" ? input.messages() : input.messages` (`:203`) — the LIVE per-step holder.
- ✓ `read session/prompt.ts:2048,2112`: `liveMessages = msgs` and `messages: () => liveMessages` — the holder the tool observes is the one the request replays.
- ✓ `read message-v2.ts:1756-1823` (the wire decision) and `:1412-1442` (`releaseExpiredParts`): the two gates that decide whether a result's bytes are still in the window.
- ✓ `read message-v2.ts:1159-1189` (`addressableLines`) + `:1129-1133` (`READ_ROW`): the one line selector and the one row dialect.
- ✓ `read tool/read.ts:405-412`: the read output's shape — `<path>…</path>`, `<type>file</type>`, `<content>` rows; `:625` — the chain covers EVERY line, so an offset window's labels are the file's own labels.
- ✓ `read tool/read.ts:151-164` (path resolution) vs `tool/edit.ts:691-693` (the same base, `Instance.directory`) — the two tools resolve a relative path against ONE base, so the window can compare them.
- ✓ `read test/session/tool-context-freshness.test.ts` (whole): the REAL `SessionTools.resolve` is testable with a small layer set (`Agent`, `CrossSpawnSpawner`, `Permission`, `Plugin`, `ToolRegistry`, `Truncate`, an MCP stub) + `ProviderTest.model` — the caller wiring is coverable, not only the tool.
- ✓ `read plans_completed/2026-10-20_edit-label-remap-slice-2.md` (whole): R1's own words — «The in-window set is read from the runtime's own replay/selection, never guessed; if the edit tool cannot reach it, that gap is named, not substituted».

## Tasks

- [x] **T1 — ONE authority for «is this result still in the window».** DONE — `message-v2.ts:1299-1346` `replayedToolOutput(part, options)` (exported) and the renderer CALLS it (`:1825`); `labelsIn` (`:1200`) reads the ONE row dialect (`READ_ROW`). The refactor is a MOVE, not a rewrite. Receipt: `test/session/message-v2.test.ts` run `20261021T214232Z_dde9db37` — 47 pass / 0 fail, exit 0 (the conversion's bytes unchanged).
- [x] **T2 — the runtime's window computation.** DONE — NEW `packages/opencode/src/session/window-labels.ts`: `windowLabelsFor(messages, filePath, options)` + the `WindowLabelsResolver` type. It reads the wire text through T1, applies the span-expiry gate through the exported `isSpanExpired`, and names the file by the printed `<path>`, else by the call's own `input.filePath` (a narrowed `kept` result has no header), else by the part a `recall` brought back. Receipt: `test/session/window-labels-t137.test.ts` run `20261021T215025Z_2320fbeb` — 4 pass / 0 fail (released → 0 labels; held → exactly its 3 rows; `kept` → only the kept rows; a file never read → the EMPTY set).
- [x] **T3 — wire the caller.** DONE — `session/tools.ts:208-220` puts the resolver into `ctx.extra.windowLabels` (the live per-step holder, `prompt.ts:2112`); `replayOptions` (`:110-115`) is filled by `session/prompt.ts:2105-2107` from the SAME `toolReplayOptions(config, session.id)` the conversion uses — one source for the turn and the replay cap. Receipt: the REAL `SessionTools.resolve` case in the session suite — 4 pass / 0 fail.
- [x] **T4 — the edit tool uses the set.** DONE — `tool/edit.ts:925` reads `ctx.extra["windowLabels"]`, `:934` hands the set to `addressReport`. `undefined` (no session context reaches the tool) keeps the map COMPLETE — the safe direction. Receipt: the tool suite — 4 pass / 0 fail, plus the MUTATION control in B1: without that one line the map lists 5 labels instead of 3.
- [x] **T5 — read-only, and the bytes prove it.** DONE — the window is an INPUT: no part, no stored output and no wire byte is rewritten; the map is APPENDED in the edit result only. Receipt: the byte-identity case — the stored parts' JSON and every part's REPLAYED text are equal before and after the edit.

## Smoke Tests

Predicted BEFORE each run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction | actual |
|---|---|---|---|
| B1 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-window-labels-t137.test.ts` (MUTATION: the one line that hands the set to the report removed) | **RED** — the map lists the out-of-window labels too | **RED as predicted** — run `20261021T214108Z_abbe49e2`, exit 1, 2 fail: `expect(map.size).toBe(3)` → **Received: 5**; the empty-window case → **Expected: 0, Received: 5**. The oracle DETECTS this exact defect. (The first mutation attempt died on a SYNTAX error — a delete-artifact of the edit tool, § Tool findings.) |
| B2 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-window-labels-t137.test.ts` (AFTER T1-T5) | **GREEN** — 4 cases: in-window only, byte-identity, the empty-set case, the no-resolver fallback | **GREEN** — run `20261021T214153Z_1403a62a`, 4 pass / 0 fail, exit 0, 16 expect() calls |
| B3 | `cmd_runner start --cwd packages/opencode -- bun test test/session/window-labels-t137.test.ts` | **GREEN** — the runtime's set + the REAL `SessionTools.resolve` wiring | **GREEN** — run `20261021T215025Z_2320fbeb`, 4 pass / 0 fail, exit 0 |
| B4 | `cmd_runner start --cwd packages/opencode -- bun test test/session/message-v2.test.ts` | **GREEN** — the renderer's bytes are unchanged by the T1 move | **GREEN** — run `20261021T214232Z_dde9db37`, 47 pass / 0 fail, exit 0 |
| B5 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-label-remap-t123.test.ts` | **GREEN** — slice-2's own suite | **GREEN** — run `20261021T214223Z_27164ddb`, 5 pass / 0 fail, exit 0 |
| B6 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit.test.ts` | **GREEN** — the edit suite | **GREEN** — run `20261021T214251Z_6bad08f7`, 25 pass / 0 fail, exit 0 (the RESULT lines live in the RAW `stdout.log`; the cleaned `stdout_text.log` dropped them — § Tool findings) |
| B7 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-exact.test.ts` | **GREEN** — slice-1's pure suite | **GREEN** — run `20261021T214353Z_3aa45110`, 34 pass / 0 fail, exit 0 |
| B8 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-overlap-t114.test.ts` | **GREEN** — slice-1's refusal suite | **GREEN** — run `20261021T214402Z_a8c6520a`, 7 pass / 0 fail, exit 0 |
| B9 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/edit-description-contract.test.ts` | **GREEN** — the description contract | **GREEN** — run `20261021T214430Z_c4d36043`, 7 pass / 0 fail, exit 0 |
| B10 | `cmd_runner start --cwd packages/opencode -- bun typecheck` | **GREEN** — exit 0 | **GREEN** — run `20261021T214829Z_ec844957`, exit 0, no diagnostics |
| B11 | `cmd_runner start --cwd . -- pwsh -NoProfile -File _build.ps1` (from the repo root) | **GREEN** — exit 0, `state.json` read back | **GREEN** — run `20261021T214528Z_a3f2e120`, exit 0, «✓ built in 33.82s», «[OK] Build complete - artifacts in dist/» |

## Risks

- The refactor touches the CONVERSION (KV-cache critical). It is a MOVE, not a rewrite: the extracted function returns the same text the inline chain produced, and the renderer's `reportCut` calls keep their order and their bytes. B4 is the guard; a divergence in the wire bytes is a cache event, so it is measured, not argued.
- A window computed with DIFFERENT options than the wire (a different turn, a different replay cap) is a window that lies — it would claim labels the wire dropped. T3 passes ONE `toolReplayOptions(...)` call to both the conversion and the window; the cap and the turn come from there.
- A label collision across two lines of one file would put a stale label in the map. The chain makes a collision a 32-bit coincidence inside one file; the set is per-file, so no other file's labels can enter it.
- The map is COMPLETE when the runtime cannot reach a set (no session context — a plugin or a direct tool call). That is the pre-t123 behaviour, and it is the safe direction: a complete map may name a line the model cannot see; a filtered map that lies would hide one it can.
- The window is READ-ONLY input. Nothing in this plan writes to a stored part, to the wire, or to the tail.

## Tool findings

- **The `edit` tool's DELETE corrupts the file it deletes from.** Deleting a line with the documented empty `newString` left `packages/opencode/src/tool/edit.ts` with its last two lines DUPLICATED after a stray `)` — four junk lines, a syntax error, and the tool reported the write as done. Measured: run `20261021T213913Z_16eba787` died with «Unexpected )» at `edit.ts:986`, the whole suite failing to load. The repair is a REPLACE with a non-empty `newString` (the span's neighbours' text), which is what this plan's own reverts use. **The class:** an editing instrument that silently corrupts its target and reports success — the next cycle should own a delete as a replace, not as an empty string.
- **The cleaned `stdout_text.log` can DROP the verdict.** `cmd_runner` run `20261021T214251Z_6bad08f7` (the slice-1 `edit` suite) wrote 443 bytes: the RAW `stdout.log` carries «25 pass / 0 fail / Ran 25 tests», while `stdout_text.log` stops right after the bun banner. A reader of the text log alone would call a green run EMPTY. **The class:** the text view is not a faithful view of the raw one — the raw log is the witness, and a `state.json` with `exit_code: 0` is not a verdict until the lines are read.

## Out of scope

- The MAP's shape, its budget, its cut note and the `read`-offset recovery hint — t123 owns them; this plan supplies the set.
- `read`'s own window (16 384 lines / 256 KB), the `recall` keep/release machinery, and the fold — the window computation READS those decisions, it does not change them.
- `bin/`, the kernel, `prompt_kernel/`, and the storage plane.

## Rollback

T1: revert `message-v2.ts` (the extraction is a pure move). T2: delete `session/window-labels.ts`. T3: revert `session/tools.ts` + `session/prompt.ts` (the `extra` bag entry is additive; removing it restores the pre-t137 behaviour exactly). T4: revert `tool/edit.ts` (one argument). No data migration, no stored-state change, nothing to undo in the DB.

## Residuals

- The `recall` path — a recalled result's rows come back into the window, and the file is named through the part the recall names (`input.id` → the source part in the same message list). The code path is there; the PROOF is not (a recall needs a stored part in the DB, which this fixture does not build). UNKNOWN, not assumed.
- The `kept` + `recall` combination is not covered: a narrowed selection that a recall then widens. Same reason.
- The window is computed per edited file, per call: a batch of N files walks the message list N times. The walk is O(parts) and the list is bounded by the fold, so the cost is expected to be negligible — but it is NOT MEASURED, and a batch of many files is where to look first.
