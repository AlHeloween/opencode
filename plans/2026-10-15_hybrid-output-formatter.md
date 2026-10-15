<!-- intention: hybrid tool output hides what the service actually returns -> the output shows every hit's
true source, its rung and its source_stamp, and a zero on the code leg is visible -->
<!-- goal_sv:
Keywords: hybrid-output 0.35, source-labeling 0.25, source-stamp 0.20, evidence-visibility 0.20
Semantic dominant: The hybrid output formatter shows what the service actually returns — real source labels, rung, stamp with scope — instead of mislabeling web hits as Sourcegraph and dropping the evidence fields.
md5: 8f4c2a91d7e3b5a6c9d0e1f2a3b4c5d6
prev-md5: 00000000000000000000000000000000
parent-goal-md5: bb33c8057b8b8034611310aae9bb9f85
-->

# t56 — universalsearch hybrid output: show what the service returns, under the right label

## Ground (2026-10-15, this session)

- `packages/opencode/src/tool/universalsearch.ts` `executeHybridSearch` (lines 391–452):
  - line 435: `result.source === "local" ? "[Local]" : "[Sourcegraph]"` — but the service
    (`D:\zPython\universal-search\src\hybrid.rs:52,86`) sets `source` only to `"sourcegraph"` or
    `"web"`; `"local"` is never produced, so every WEB hit prints as `[Sourcegraph]`.
  - lines 436–440 print only `file||url`, `repository`, `line`, `preview`, `url` — web hits carry
    `title`, `description`, `rung` (dropped); the agent sees a bare URL under a wrong label.
  - sourcegraph hits carry `rung: "Inferred"` and
    `source_stamp {authority_class: "source_code", url_provenance, content_hash, scope: "metadata"}`
    (hybrid.rs:56–61) — all dropped; `metadata.source_stamps` is never filled (the web branch does
    fill it, lines ~305–322, via `Constitution.makeSourceStamp` / `formatSourceStamp`).
  - line 431 header «Results from local code search (first) and Sourcegraph (second)» is stale —
    the service answers sourcegraph + web.
- Service contract (`hybrid.rs` `HybridResponse`): `query`, `mode`, `result_count`,
  `sourcegraph_results`, `web_results`, `results[]` — each result carries `source`
  (`"sourcegraph"` | `"web"`), `rung` (`"Inferred"` | `"Guess"`), and for sourcegraph hits a
  `source_stamp` with `scope: "metadata"`.
- `Constitution.formatSourceStamp` (constitution.ts:2017) prints
  `source_stamp: authority_class=… kind=… infomark=… url_provenance=… content_hash=…` — it does NOT
  print `scope`. A `scope: "metadata"` stamp must read as metadata-level evidence, not content-level.

## Tasks

- [ ] T1 — Tests first: add to `packages/opencode/test/tool/universalsearch.test.ts` a
  `describe("tool.universalsearch hybrid output")` with a fake service (Bun.serve, port 0) answering
  `/hybrid` with the real service shape: one web hit (source `web`, rung `Guess`, title,
  description, url) and one sourcegraph hit (source `sourcegraph`, rung `Inferred`, file, repository,
  line, preview, url, `source_stamp` with `scope: "metadata"`).
  RED on today's output: wrong label on the web hit (`[Sourcegraph]` instead of `[Web]`), missing
  rung, missing stamp line, missing scope, missing counts, stale header.
  <!-- sv:
  Keywords: test-first 0.40, hybrid-fixture 0.30, red-baseline 0.30
  Semantic dominant: A named-file test drives the real executor against a fake /hybrid endpoint and fails on today's mislabeled, evidence-dropping output.
  md5: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d7
  -->

- [ ] T2 — Implement in `executeHybridSearch`:
  1. label by `result.source`: `"sourcegraph"` → `[Code · Sourcegraph]`, `"web"` → `[Web]`,
     anything else → `[<value>]` (never a guess);
  2. print `title` when present; `description`/`preview` when present; for code hits
     `repository` + `line`; `url` when present; the hit's `rung` when present;
  3. for a hit carrying a `source_stamp` object: print it through `Constitution.formatSourceStamp`,
     with `scope` appended when present (`scope=metadata` must read as metadata-level, not
     content-level evidence); reuse the web branch's stamp code — no second formatter;
  4. fill `metadata.source_stamps` from the hits' stamps (as the web branch does);
  5. header: `_Results from Sourcegraph code search and web search_` and print
     `sourcegraph_results` / `web_results` counts so a code-leg zero is visible (a real zero per the
     stream contract).
  <!-- sv:
  Keywords: source-labeling 0.30, format-source-stamp 0.25, hybrid-output 0.25, metadata-stamps 0.20
  Semantic dominant: The formatter labels by the service's own source value, prints rung and stamp with scope, fills metadata.source_stamps, and prints per-leg counts.
  md5: b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1
  -->

- [ ] T3 — Oracles: the new tests GREEN; the pre-existing tests in the same file still green
  (regression); `bun typecheck` from `packages/opencode` clean; `_build.ps1` exit 0.
  <!-- sv:
  Keywords: oracle 0.40, regression 0.30, typecheck 0.30
  Semantic dominant: The change is proven by the named test file green, the file's prior tests green, typecheck clean, and the mandatory build.
  md5: c3d4e5f6a7b8c9d0e1f2a3b4c5d6a1b2
  -->

## Smoke Tests

- `cmd_runner start --cwd packages/opencode -- bun test test/tool/universalsearch.test.ts` —
  RED first on the new hybrid-output tests (wrong label, missing rung/stamp/counts), then GREEN
  after T2, with the file's pre-existing tests still passing.
- `bun typecheck` from `packages/opencode` — clean.
- `pwsh -NoProfile -File _build.ps1` from repo root — exit 0.

## Bounds

steps 30, tools 70, loops 3, depth 2, time 1 800 000 ms. No build by this robot (fleet lead
builds) except the mandatory final `_build.ps1` receipt; never `bin/`.

## Constraints

- Branch `Local_Development`; no worktree; stage by path only (`git add <path>`), never `-A`.
- `_progress_log.md` is shared: append one entry; on conflict keep BOTH.
- Tests: one file per call, through cmd_runner; read `state.json` and the whole output.
- A red test is first a question about the TEST against the requirement; never weaken it.
