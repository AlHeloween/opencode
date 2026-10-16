<!-- intention: unmarked tool schemas (model misuses tools) -> gate-marked + densified descriptions, integrity-tested (in place only) -->
<!-- goal_sv:
```yaml
Keywords: tool-gates 0.30, inference-stability 0.25, in-place-densify 0.20, integrity-test 0.15, wire-bytes 0.10
Semantic dominant: Every owned tool description names its kernel gates and principle in place, proven by an integrity test.
md5: 63a1f2b4c5d6e7f8091a2b3c4d5e6f70
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```
-->

# t63 — every tool description names its gates (when and where); densify in place only

## Goal

Owner, 2026-10-15: «никаких внешних доксов, это нарушает стабильность инференса» + «в тулах
должны быть пометки на гейты — когда и куда» + «плюс обязательные ошибки из-за непонимания
принципов». Every owned tool description carries a compact `Gates:` line (kernel gate names:
G1 GROUND … G9 CLEAN_STATE, @ORACLE, @SOURCE_ROUTING, …) plus its PRINCIPLE (why, when NOT to
use) — in place, no pointer outside the request. t61 §4 densify applied only where it needs no
doc pointer (edit D1, cua D4, question/summaryedit/compact D8, duplicate `todo` schema M1).

## Non-goals (quoted exclusions)

- No D0/D2/D3/D5/D6/D7/D9 as written: each saves bytes by pointing at docs/ or the registry —
  void per the owner ruling (§9 of t61 REPORT). They may return only as in-place compressions.
- No pointer to another tool's description (D0 shape): no ACL proof was established that `bash`
  is present for every agent carrying `cmd`/`run` (explorer_agent denies all three), so the
  pointer is inadmissible; the constitution blocks stay in place.
- No MERGE M2–M7 (separate owner decisions + test moves).
- No external MCP (`codegraphcodegraph*`) or plugin (`github*`) surfaces: not ours to densify.

## Grounding (G1 receipts)

- t61 REPORT: `experiments/2026-10-15_tool-schema-review/REPORT.md` (§9 owner ruling, §4 D-items,
  §1 inventory). Baseline reproduced: `node inventory.mjs` →
  `bin: 58 tools, 152922 B` (Exact, matches t47).
- Owned = 58 wire − 8 MCP − 2 plugin = 48 wire entries = 47 definitions + the `todo` routing
  alias (`tool.ts:93`). Descriptions live in 36 `.txt` files + 12 inline `.ts` files.
- `docs/` pointers inside descriptions: exactly one — `fossilgrep.txt:47`
  (`docs/fossil-snapshot.md §2.0.1`); `write.txt`'s `docs/note.md` is a JSON example path, not a
  pointer. No description string in `.ts` points at docs/ (remaining hits are code comments).
- Gate marks today: incidental G-words in 12/36 txt, no uniform `Gates:` line (none).
- M1 root cause: `session/tools.ts:469-473` publishes the alias as a second full wire schema
  (same object, +2 954 B). Execution route for the spelling is that same entry; `llm.ts`
  `resolveToolName` (alias → canonical) exists but has no caller (dead). `streamText` receives
  `activeTools` (llm.ts:912) alongside full `tools` — the seam for the fix.

## Tasks

- [x] <!-- sv: gate lines on all 36 txt descriptions --> S1 Gate line + principle on every `.txt` description (37 files incl. powershell.txt; run 20261016T014658Z_4820fefe GREEN)
- [x] <!-- sv: gate lines on inline ts descriptions --> S2 Gate line on every inline description (12 `.ts` files: invalid exempt — synthetic "Do not use")
- [x] <!-- sv: fossilgrep docs pointer removal --> S3 Remove the `fossilgrep.txt:47` docs/ pointer, rule carried in place compressed
- [x] <!-- sv: edit cua question summaryedit compact densify --> S4 In-place densify D1 (edit −1349 B), D4 (cua), D8 (compact/question/summaryedit) — no meaning/safety/routing name dropped
- [x] <!-- sv: todo alias wire dedup --> S5 M1: `todo` off the wire via `offeredNames` (llm.ts activeTools) + repair alias step (tool-call-repair.ts); unit tests in tool-define + json-repair-policy GREEN
- [x] <!-- sv: description integrity test gates --> S6 Integrity test extended (RED run 20261016T013141Z_7247fcfd: 5 pass/3 fail → GREEN run 20261016T014658Z_4820fefe: 8 pass)
- [x] <!-- sv: bytes receipts and regression tests --> S7 Wire 152922 → 161869 B projected (+5.9%); tests green (§log); build `20261016T015252Z_faff652b` exit 1 with bundle+smoke PASS (10.0.1367) and the t62 residual only (dist copy held by pid 11188, t59 oracle) — commit naming this plan

## Gate-line contract (applies to S1/S2)

- One compact line near the top (txt: within first 6 lines; inline: prepended to the string),
  form `Gates: <gates where used> → <what it feeds>; result = <rung/kind>. <principle: when NOT>.`
- Gate names only from the kernel (`prompt_kernel/source.py` + addons): G1 GROUND … G9
  CLEAN_STATE, @ORACLE, @SOURCE_ROUTING, @INFOMARK, @TOOLCHAIN_QUALIFICATION,
  @SURFACE_PREPARATION, @PLAN_BINDING_ENFORCEMENT, DELEGATION. Never invent a role.
- Per-tool gate table (derived from kernel text + actual use):

| tool | gate line essence |
|---|---|
| read/glob/grep/list | G1 locate/read (grep LAST after codegraph) → G6 bind; Inferred locator, never absence proof |
| codegraph | G1 structure first → G6 bind/impact; Inferred structural evidence; empty graph = gap |
| edit/write | G7 MODIFY under G4 envelope, G6 binding + sv + READY + smoke; proven by read-back (@ORACLE) |
| bash/cmd/run | G7 orchestration; EXECUTE_TEST runs are G8 oracles per declared claim |
| task/pipeline | DELEGATION G1/G2/G6/G7/G8 by type; never skips G4, never marks G8 PASS |
| aicall | isolated falsifier (G3 drafts / G8 self-verdicts); Inferred ceiling, never a stamp |
| messagesearch/sessionread | G1 history/transcript; locator + Exact provenance of what was said |
| universalsearch/webfetch | G1 external prior art / primary fetch (@SOURCE_ROUTING); snippets Guess, web never Inferred w/o source_stamp |
| question | G4 ASK (also G0 on ambiguous intention); only what user words alone can answer |
| todowrite | G2/G3 tracking surface; boxes close on oracle evidence, never on prose |
| compact/summaryedit | G9 fold / pre-fold body fix; fold is not closure |
| planenter/planexit | plan_mode entry / return (G3–G4 boundary) |
| reasoningenter/exit | reasoning_mode switch (protected memory only) |
| cua/imagerender/samply | G8 visual / structural / CPU-profile oracle support |
| dbread/logsearch | G1/G8 read-only state + log evidence |
| fossilgrep/fossilcell | G1 snapshot-history / cross-project reads; testimony until verified |
| memory/svm/checkstate/planstatus | durable criteria (G1 read, G9 persist) / manifests / rights+window / portfolio audit |
| recall/tempenable/tempdisable | content-lifecycle re-acquire / hold+release (reason required) |
| compare/treediff | G6/G8 divergence inventory, read-only |
| restore | G7 recovery from this session's edit backup |
| skill/capability/lsp | any-gate prep / media bind prep / post-edit diagnostics (never a G8 oracle) |
| joboutput/jobwait/jobkill/jobreset | G7/G8 background-job lifecycle; silence = no evidence |
| invalid | exempt (synthetic fallback, never authored) |

## M1 design (S5)

- `llm.ts:912`: `activeTools` excludes alias keys (`x in TOOL_ALIASES`) alongside `invalid` —
  the wire drops the 2 954 B duplicate; the full `tools` record (incl. `session/tools.ts`
  registration) keeps executing the spelling.
- `tool-call-repair.ts`: reuse the dead `resolveToolName` — an alias toolName repairs to
  canonical (covers providers/SDKs that enforce activeTools at dispatch).
- Falsifier: wire without `todo` entry while a `todo` call still executes (unit tests pin both).

## Test contract (S6/S7)

- Extend `test/tool/description-integrity.test.ts`: (a) every `.txt` description has a `Gates:`
  line within its first 6 lines; (b) every live registry description (minus synthetic) has one;
  (c) no description matches a docs-pointer pattern (`see docs/`, `(docs/*.md`, `docs/*.md §`);
  each with the MUST-match control the file already uses. RED today (no `Gates:` lines).
- Existing tool tests stay green (parameters test: densify must keep every parameter named).
- Bytes: static before 152 922 B; after = before − 2 954 (M1) − densify cuts + gate-line growth
  (captures are frozen, so inventory.mjs re-run is a control, not the measurement).

## Smoke Tests

- `test/tool/description-integrity.test.ts` RED before (new asserts), GREEN after.
- `parameters.test.ts`, `tool-define.test.ts`, `registry.test.ts`, `task.test.ts`,
  `question.test.ts`, `compact.test.ts`, `cua.test.ts`, repair tests: green, one file per call.
- `_build.ps1` once (lock-serialized); t62 residual may recur (live server holds dist binary) —
  never stop that process, record run id + holder pid.

## Risks

- Gate-line wording drift vs kernel: contained by the names-only rule + test pins presence,
  not prose.
- `activeTools` SDK semantics (filter wire vs dispatch): contained by keeping the execution
  registration + repair alias step; worst case degrades to model retry with `todowrite`.
- Shared tree: stage only own paths; `_progress_log.md` append-only (keep both on conflict).
