# universalsearch — hybrid by default, timeout that fits hybrid

<!-- intention: the tool's default source is `web` and every path shares one 60 s client timeout, so the
default call is a pure-web call and a real hybrid call (measured up to 64 s) is aborted by our own client
-> the default resolves to `hybrid` (owner, 2026-10-15: «давай перейдем на гибрид… из code выборок часто
вылазят ссылки на научные публикации так что это реально удобно чтобы быстро получить inferred медоиды»)
and the hybrid path carries its own client timeout derived from the measured baseline plus the service's
own 50 s upstream bound; web/code timeouts unchanged; SOURCE_ROUTING stays in the description -->

<!-- goal_sv:
Keywords: hybrid-default 0.30, timeout-derivation 0.25, baseline-measured 0.20, source-routing 0.15, red-first 0.10
Semantic dominant: universalsearch defaults to hybrid so one call grounds code and papers, and the hybrid path gets a client timeout derived from the measured baseline and the service's own 50 s upstream cap — never a bare number from recall.
md5: b7e4d29c6a13f85de90b2c4718fa6d3a
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

- **plan_id:** 2026-10-15_universalsearch-hybrid-default
- **revision:** 1
- **state:** ACTIVE (owner task t46, envelope: `universalsearch.ts` + its test + the tool's own `.txt` description, this plan, `_progress_log.md`; no `_build.ps1` — t44 runs the batch's one build)
- **reported:** owner, 2026-10-15 (verbatim above); measured by Claude, 2026-10-15: `POST :3005/hybrid` → 64 s against our own 60 s client timeout.

## Step-1 baseline — measured 2026-10-15 (job run-1, node fetch against http://127.0.0.1:3005, cap 90 s)

| # | shape | query | seconds | status | sourcegraph_results | web_results |
|---|-------|-------|---------|--------|--------------------:|------------:|
| 1 | code-symbol | `resolveSearchSource` | 27.1 | 200 | **5** | 10 |
| 2 | code-pattern | `AbortController fetch timeout pattern` | **55.3** | 200 | 0 | 10 |
| 3 | paper-topic | `PagedAttention KV cache block table` | 24.3 | 200 | 0 | 10 |
| 4 | mixed | `Effect TypeScript Effect.tryPromise` | 39.4 | 200 | 0 | 10 |
| 5 | paper-topic-2 | `retrieval augmented generation citation hallucination benchmark` | 22.7 | 200 | 0 | 10 |
| W1 | web pair of #2 | `AbortController fetch timeout pattern` | 18.9 | 200 | — | 10 |
| W2 | web pair of #3 | `PagedAttention KV cache block table` | 4.1 | 200 | — | 10 |

- ✓ Both legs return on a code-shaped query: #1 (`resolveSearchSource`) carries `sourcegraph_results: 5` + `web_results: 10` — the owner's check passes; the four 0s are non-code queries (a zero is a real zero per the service doc), not a dead leg.
- ✓ Measured hybrid max **55.3 s** > the current client `DEFAULT_TIMEOUT = 60000` margin: Claude's 64 s case confirms the client aborts a healthy call.
- ✓ Web leg alone: max 18.9 s — well under 60 s; **web/code timeouts stay unchanged**.

## Timeout derivation (written into the code comment, no bare number)

- Service's own bound: the code leg streams Sourcegraph `/.api/search/stream` with a **50 s upstream timeout** (service doc, owner).
- Composed worst case: 50 s (code-leg cap) + web-leg scrape observed up to **18.9 s** (W1) ≈ **69 s**.
- Measured hybrid max: **55.3 s** (#2); Claude's independent case: 64 s.
- `HYBRID_TIMEOUT_MS = 90_000` = composed worst case (≈69 s) + ~30% headroom; it clears every observed case (55.3, 64) with margin. The 60 s default aborted a healthy 64 s call — that is the defect.

## Tasks

- [x] **T1 — baseline.** 5 hybrid + 2 paired web probes recorded above (job run-1). Both legs confirmed on a code-shaped query; measured max 55.3 s. Receipt: this table.
- [ ] **T2 — RED tests first** (`packages/opencode/test/tool/universalsearch.test.ts`): (a) `resolveSearchSource({})` → `"hybrid"` (current: `"web"` — RED); (b) exported `HYBRID_TIMEOUT_MS` > 55 300 (current: no such export — RED). Run through `cmd_runner` from `packages/opencode`, one file, read `state.json` + whole output.
- [ ] **T3 — implement** (`packages/opencode/src/tool/universalsearch.ts` + `src/tool/universalsearch.txt`): `resolveSearchSource` default `"hybrid"`; parameter description keeps SOURCE_ROUTING verbatim clauses — web snippets stay Guess, a code hit is local code (Inferred), a DOI/paper link becomes Inferred only after its primary URL is fetched; `HYBRID_TIMEOUT_MS` with the derivation comment above, wired into the hybrid executor's abort timer only; `.txt` default/table/parameter rows follow the code. Web/code/agent paths keep `DEFAULT_TIMEOUT`.
- [ ] **T4 — GREEN + typecheck.** Rerun the same test file (PASS), then `bun typecheck` from `packages/opencode`.
- [ ] **T5 — close.** `svm render` from the repo root; commit plan + code + test + `_progress_log.md` by path (never `-A`); the commit names this plan. `_build.ps1` NOT run — reported pending (t44).

## Smoke Tests

All through `cmd_runner` (`start --cwd packages/opencode -- bun test <file>`); every prediction precedes its run (@SMOKE_BEFORE); a delta off the prediction is a divergence, not a pass.

| # | command | prediction |
|---|---------|------------|
| B1 | `bun test test/tool/universalsearch.test.ts` on the PRE-change tree | RED — the default test expects `hybrid` and gets `web`; `HYBRID_TIMEOUT_MS` is `undefined` against `> 55 300` |
| R1 | same file after T3 | PASS — default resolves `hybrid`; explicit `web`/`code`/`agent` unchanged; `HYBRID_TIMEOUT_MS` > 55 300 |
| R2 | `bun typecheck` from `packages/opencode` | PASS, 0 errors |

## Residuals

- `sourcegraph_results: 0` on non-code queries is the service's real-zero contract, not a defect; if a future code-shaped query returns 0, that is a new finding for the service lane, not this plan.
- The hybrid renderer labels local results `[Local]` and Sourcegraph `[Sourcegraph]` but emits no `source_stamps`; paper links in hybrid output stay Guess until a primary URL is fetched — unchanged behaviour, noted so nobody expects stamps from this plan.
- The service's 50 s code-leg cap is its own lane (`D:\zPython\universal-search`); this plan only derives the client bound from it.

## Out of scope

- `_build.ps1` (t44 runs the batch's one build), `bin/`, `prompt_kernel/`, other lanes' dirty files.
- Any change to web/code/agent timeouts or to the service itself.

## Rollback

`git revert` of this plan's commit restores `web` as default and the single 60 s timeout; the plan file moves back to `plans/` with its boxes reopened.
