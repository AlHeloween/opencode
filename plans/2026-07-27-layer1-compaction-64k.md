# Layer-1 64K Summary Cadence With Context-Safe Fallback

## Intent

Change the normal Layer-1 incremental-summary target from `32_768` to
`65_536` content tokens. The counter remains the current deterministic
`chars / 4` estimate over text, reasoning, tool output, subtask, and patch
content. This is a cadence change, not a compaction redesign.

The target must remain reachable on each provider. A 65,536-token context
cannot safely wait for a 65,536-token open window: the existing overflow
guard reserves capacity and may need output room before the next model call.
Therefore the implementation must use 65,536 as the normal target and a
lower, provider-aware *effective* target only when the model's safe usable
context cannot reach it.

## Exact current-state assessment

| Surface | Current behavior | Required outcome |
|---|---|---|
| `compaction.ts` `SUMMARY_INTERVAL_TOKENS` | `32_768`; also sizes range trimming and the unsummarized Layer-2 Recent fold | Export `65_536` as the normal Layer-1 target; stop coupling Layer-2 retention to an unsafe universal target. |
| `prompt.ts` `maybeInjectSummary()` | Recomputes the open window, waits for a fully completed assistant turn, then injects the synthetic request | Preserve completion/pending guards; compare against the provider-safe effective target. |
| `overflow.ts` | Compacts at `usable(context - reserve)` or when estimated content plus output reaches context | Remains the authority for hard overflow; do not relax its safety checks. |
| `compact()` | Soft-hides visible records and creates `message*`; with no summaries, keeps only the last interval | Preserve soft-hide and exact archive; cap retained unsummarized Recent with the same effective target so compaction converges. |
| `reasoning.txt` | Universal system-prefix text says `≈every 32K tokens` | State the 64K normal cadence and bounded lower-context fallback. |

### CodeGraph finding: required convergence guard

For a model with `context = 65_536`, the default 15% reserve makes
`usable()` about `55_706`. A blind `32_768 -> 65_536` replacement causes:

```text
open window approaches usable capacity
  -> hard overflow compacts before 64K Layer-1 can run
  -> compact retains the same ~55K unsummarized Recent block
  -> next loop overflows again before a Layer-1 summary request
  -> no context reduction / no summary boundary
```

The plan must eliminate this loop without reviving a special `message* > 32K`
rule. The counter still uses the same open-window rule after compaction.

## Scope

- [x] Change the exported normal target to `SUMMARY_INTERVAL_TOKENS = 65_536`.
- [x] Add one named, tested provider-aware effective-window calculation. It
  must be no greater than `65_536` and leave enough room for the completed
  normal answer, the newly injected synthetic summary request, and the
  summary response's provider output budget. Unknown-context (`context ===
  0`) preserves current no-overflow behavior and uses the normal target.
- [x] Thread that effective target through both Layer-1 injection and
  no-summary Layer-2 Recent trimming. The two paths must use the same value
  for a given turn so an overflow compact produces a next visible window that
  can make progress toward a summary rather than immediately overflowing.
- [x] Keep 64K exact on sufficiently large-context models; use the lower
  value only where context/output headroom proves 64K unreachable.
- [x] Update affected comments, prompt wording, architectural docs, and tests.

## Explicit non-goals and non-destructive boundary

- Do **not** delete messages, summaries, checkpoints, fossils, or database
  rows. `info.compacted` remains a soft-hide only; `session-read` and
  `messagesearch` remain archive recovery paths.
- Do **not** alter `isAssistantTurnComplete`, summary validation, retry limit,
  terminal markers, ignored Exact range markers, exact stamps, fossil diffs,
  CodeGraph impact, or synthetic resume behavior.
- Do **not** replace the synthetic in-band summary flow with a compaction
  agent, a mode switch, or an out-of-band prompt.
- Do **not** change provider limits, configured overflow reserve policy,
  `cache-control.ts`'s unrelated `32k+ tokens wasted` cache-cost comment, or
  historical completed-plan records.
- Do **not** cherry-pick `Trash_Started:f706d684d1`; it predates and removes
  required summary completion, validation, retry, and terminal-marker logic.
- Do **not** rewrite Git history, reset the worktree, merge branches, or make
  any destructive data migration.

## Implementation sequence

1. **Define cadence and safe effective threshold**

   In `packages/opencode/src/session/compaction.ts`, change the exported
   normal interval to `65_536` and rename/comment internal helpers so they
   describe *content-token estimates*, not assistant output tokens. Add a
   small reusable calculation whose contract is:

   ```text
   effective_target = min(65_536, largest content window that passes the
   current usable-context and *post-answer summary request/response*
   headroom safety conditions)
   ```

   It must rely on the same `usable()` and `ProviderTransform.maxOutputTokens`
   semantics already used by `isOverflowFromContent`, rather than introducing
   a second reserve formula. Its budget must reserve room after the preceding
   normal answer for both the synthetic request and the summary response (or
   compact/trim before injection). Keep its input explicit (`Config.Info`,
   resolved `Provider.Model`, and relevant visible-content estimate/budget) so
   tests can exercise 65K, 128K, and large-context models deterministically.

   `computeOpenWindowTokens()` is deliberately a raw `chars / 4` scheduling
   counter, while overflow uses tokenizer/calibration estimates, skips ignored
   text, and sees rendered `message*` formatting overhead. The helper is an
   overflow-safe **policy bound**, not a claim that these two measurements are
   numerically equal. The implementation must conservatively bridge the two
   measurements and prove the resulting summary request fits.

2. **Use the same target on both sides of the loop**

   In `packages/opencode/src/session/prompt.ts`, resolve the provider model
   and configuration already available in the run loop, calculate the
   effective target, and pass it to Layer-1 scheduling. Preserve this exact
   order: no pending summary; no existing pending range; completed assistant
   turn; then threshold check; then one synthetic request.

   Extend the `Compaction.Service.compact` input/interface (not merely a local
   helper) only as needed to receive the resolved effective target. Update
   every direct caller. When no accepted summary exists, trim Recent to that
   target. When a summary exists, preserve the current summary-bounded
   behavior. Do not derive a second fixed 32K cap. Direct/non-prompt callers
   need a safe documented default and focused test coverage.

3. **Preserve overflow as a separate Layer-2 oracle**

   Keep `isOverflowFromContent()` unchanged as the pre-request safety oracle.
   Verify that a compacted `message*` below the effective target can accept a
   summary request/response rather than repeatedly returning `"compact"`.
   The implementation must not treat `message*` specially after compaction:
   its `chars / 4` body is still the open-window counter.

4. **Update user-visible and canonical wording**

   Update current policy text in:

   - `packages/opencode/src/session/prompt/reasoning.txt`
   - `docs/compaction.md`
   - `docs/architecture.md`
   - `AGENTS.md`

   State: normal target `65_536`; lower effective target is only a
   provider-context safety fallback; summary injection remains after a normal
   assistant turn completes; Layer-2 is still overflow-only and soft-hides
   history.

   Do not update unrelated 32K values that are model limits, fixtures, or
   cache-cost commentary.

5. **Audit cache boundary before changing `reasoning.txt`**

   `[KV-CACHE RISK]` `reasoning.txt` is imported into the universal reasoning
   prefix. Changing its bytes changes the system-prefix fingerprint for new
   sessions and for permitted system/checkpoint rebuilds. Existing checkpoint
   paths remain frozen until their existing compaction refresh boundary.
   Confirm no timestamp, dynamic model value, or calculated effective target
   is injected into system text. The prompt must say only the stable policy,
   never a per-turn threshold.

6. **Reconcile plan state only after verified implementation**

   Mark this plan's checkboxes only after all post-implementation smoke tests
   pass. Then inspect `plans/` and `plans_completed/` for duplicate or stale
   threshold claims and update only current authoritative documentation.

## File impact map

| File | Change class | Reason |
|---|---|---|
| `packages/opencode/src/session/compaction.ts` | Code/service boundary | 64K normal constant; shared effective target, context-safe Recent/range trimming, and `Compaction.Service.compact` input/default. |
| `packages/opencode/src/session/prompt.ts` | Code | Calculate/use effective target without breaking completed-turn injection or hard-overflow flow. |
| `packages/opencode/src/session/overflow.ts` | Verify first; modify only if a shared predicate is required | It owns reserve/output safety; avoid duplicate math. |
| `packages/opencode/test/session/compaction.test.ts` | Test | Replace the 37.5K trim fixture with one above 64K; add low-context convergence coverage. |
| `packages/opencode/test/session/prompt.test.ts` | Test | Existing constant-based 64K timing tests adapt; add a fallback-target timing case. |
| `packages/opencode/test/session/system-compose.test.ts` and relevant system/prompt tests | Test | Prove stable composition and cache boundary after wording update. |
| `packages/opencode/src/session/prompt/reasoning.txt` | Canonical prompt text | Correct cadence, with stable non-dynamic wording. |
| `docs/compaction.md`, `docs/architecture.md`, `AGENTS.md` | Documentation | Align live architecture and governance claims with exact behavior. |

## Test matrix and acceptance criteria

| Case | Setup | Expected result |
|---|---|---|
| Standard 128K+ context | Open window just below/at `65_536`; completed assistant | No request below; exactly one synthetic Layer-1 request at/above 64K; summary validates and resume proceeds. |
| Incomplete assistant/reasoning/tool turn | Open window at effective target | No synthetic user message until `isAssistantTurnComplete` is true. |
| Large context Layer-2 | No accepted summary and Recent above 64K | `message*` retains only the configured 64K-sized tail; no history deletion. |
| 65,536-context model | A completed normal answer approaches the safe limit | The synthetic summary request and its response both fit; compact reduces visible content below the safe policy bound; next loop does not repeat compact indefinitely; one valid summary boundary is accepted. |
| Output-constrained model | Large `maxOutputTokens` leaves less headroom | Effective target lowers before overflow; the post-answer synthetic request and summary response still fit; no provider request is made with content plus output above context. |
| Existing summary | Overflow after accepted summaries | Summary links, Exact stamps, fossil/CodeGraph metadata, decisions, and Recent order remain unchanged. |
| Reasoning mode | 64K normal target and a fallback target | Summary/resume stays protected and memory-only; no mid-reasoning injection or transition. |
| Prompt cache | New/rebuilt session vs checkpoint reuse | Stable composition tests pass; only the intentional static prefix wording changes at a permitted boundary. |

## Smoke tests

Run from `packages/opencode` only, sequentially (never repository root):

```powershell
bun test --timeout 120000 test/session/compaction.test.ts
bun test --timeout 120000 test/session/prompt.test.ts
bun test --timeout 120000 test/session/system.test.ts test/session/system-compose.test.ts
bun typecheck
```

Baseline on 2026-07-27: `test/session/compaction.test.ts` passed 74/74. The
full `test/session/prompt.test.ts` suite exceeded a 150-second wrapper without
output; it was not treated as a pass.

Post-implementation on 2026-07-27:

- `test/session/compaction.test.ts`: 77 pass, 0 fail. This includes 64K normal
  trimming, non-reasoning and reasoning 65,536-context fallbacks, and
  convergence assertions.
- Targeted Layer-1 Build and Reasoning resume tests: 2 pass, 0 fail. A real
  65,536-context reasoning-model summary request/response/resume test also
  passed 1/1; its reserve matches the runtime's reasoning-output budget.
- `test/session/system-compose.test.ts`: 12 pass, 0 fail.
- `bun typecheck`: exit 0.
- Full `test/session/prompt.test.ts`: exceeded a five-minute wrapper without
  output. The focused passing cases do not substitute for this required suite.

The implementation is complete, but this plan remains active until the full
prompt-suite timeout is diagnosed and a complete passing run is recorded.

## Completion criteria

- [x] `SUMMARY_INTERVAL_TOKENS` is exactly `65_536` and standard sufficiently
  large contexts schedule Layer-1 at that cadence.
- [x] Low-context/output-constrained models use one tested safe fallback and
  never compact in a no-progress loop.
- [x] No protected-flow, archive, validation, Exact-link, or checkpoint
  invariant is weakened.
- [x] Prompt and docs state one consistent policy, and unrelated 32K values
  remain untouched.
- [ ] All smoke commands and focused convergence/cache tests pass.
