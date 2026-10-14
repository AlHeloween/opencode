<!-- intention: researcher_agent is refused any universalsearch source but "web" by a flat-ACL workaround inside the tool executor -> researcher_agent reaches every universalsearch source (web, code, hybrid, agent): the executor gate, its export, its test and every web-only description are removed, and a regression test proves source "code" is no longer refused -->

# researcher_agent — every universalsearch source

```yaml
Keywords: universalsearch-sources 0.35, researcher-gate-removal 0.25, regression-test 0.20, description-parity 0.12, build 0.08
Semantic dominant: Remove the web-only executor gate so researcher_agent reaches every universalsearch source, with descriptions and a regression test moved in the same change.
md5: 7c1e9d3a5b2f8041124a6e8d9f0b3c57
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

Owner, 2026-10-14, verbatim: «Просто разрешить universal search и все.» Context: Sourcegraph
(universalsearch source:"code", service :3005 endpoint /web/sourcegraph) decided a 3-day case
(«если бы не SourceGraph — ничего бы не получилось»), and trials/research are routed to the
researcher — who today is cut from it by `researcherWebOnly` (src/tool/universalsearch.ts:48) and
its execute check (:69-75). The kernel scope line RESEARCHER_AGENT «universalsearch source web»
is NOT edited here — prompt_kernel/** untouched, that change is the next kernel round.

## Tasks

- [x] S1 regression test first (RED): test/tool/universalsearch.test.ts drops the `researcherWebOnly` case and proves researcher_agent with source "code" (also "hybrid", "agent") reaches the permission stage instead of the web-only refusal; run RED against today's executor. <!-- sv: regression-test 0.6, red-first 0.4 --> ✓ CONFIRMED 2026-10-14: RED run 20261014T122438Z_0dadf3b0 (exit 1) — 1 pass / 3 fail, each red `expected ["universalsearch"], received []`: the call dies at the gate before the permission ask.
- [x] S2 remove the executor gate: delete the `researcherWebOnly` export and the execute check in src/tool/universalsearch.ts. <!-- sv: gate-removal 1.0 --> ✓ CONFIRMED 2026-10-14: export and execute check deleted (file 458 → 444 lines, execute now starts at `ctx.ask`); `grep researcherWebOnly` outside this plan → nothing.
- [x] S3 description parity: agent.ts researcher description + ACL comment, tool/task.txt:18, agent/prompt/researcher.txt — no web-only wording remains for the researcher. <!-- sv: description-parity 1.0 --> ✓ CONFIRMED 2026-10-14: all three updated to «any source»; grep over packages/opencode — no web-only wording left (the kernel render reasoning_prompt.txt:627 stays, per the task instruction).
- [x] S4 GREEN: the same test file passes; `bun typecheck` from packages/opencode. <!-- sv: green 0.6, typecheck 0.4 --> ✓ CONFIRMED 2026-10-14: GREEN runs 20261014T122503Z_a1868277 (4 pass / 0 fail; exit_code −1 with a complete log — the recorded cmd_runner exit-capture flake) and 20261014T122532Z_60ad33e3 (4 pass / 0 fail, exit 0); typecheck run 20261014T122555Z_20c886b0 exit 0, stderr empty.
- [x] S5 commit naming this plan, `svm render`, `_build.ps1` through cmd_runner with state.json read. <!-- sv: commit-build 1.0 --> ✓ CONFIRMED 2026-10-14: build run 20261014T122656Z_198e0d2d exit 0 (bytes_written 65 644 / dropped 0 / truncated false; smoke 10.0.1338 + reasoning_prompt.txt embedded, artifacts in dist/); `svm render` re-run; plan moves to plans_completed/ in this commit.

## Smoke Tests

- Baseline: `bun test test/tool/universalsearch.test.ts` (from packages/opencode) — today GREEN (old file, 2 cases).
- Predictions before S2: with the new file (S1 only), researcher_agent + "code"/"hybrid"/"agent" RED — ask never reached, so `asks` stays empty; the `resolveSearchSource` case unchanged GREEN. After S2: all GREEN; no other case changes; typecheck PASS; build exit 0.
- Post-change oracle: same file GREEN — `asks` equals `["universalsearch"]` with metadata.source = the requested source; `grep researcherWebOnly` finds nothing outside this plan's diff.
