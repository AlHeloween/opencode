# Prompt pins the session model — a dispatched session must not drift onto another (free) model

<!-- intention: a robot session pinned to deepseek/deepseek-flash by its dispatched prompt answered three later prompts on opencode/muse-spark-1.3-contributor-free — the third «an unpinned bound filled by a default» (docs/robot-protocol-log.md, 2026-10-13) -> a prompt that NAMES a model fills the session layer (S2), so every later reader — the TUI status line, a prompt without a model, resolveAgentModel callers — reads the pin and the session's own work never leaves it -->

<!-- goal_sv: session-model-pin, session-layer-fill, prompt-model-resolution, free-model-drift, robot-protocol-log -->

- **plan_id:** 2026-10-13_prompt-pins-session-model
- **revision:** 1
- **state:** COMPLETE

**Status:** COMPLETE

```yaml
Keywords: session-model-pin 0.30, session-layer-fill 0.24, prompt-model-resolution 0.18, free-model-drift 0.16, regression-test 0.12
Semantic dominant: A prompt that names a model fills the session layer, so a dispatched session's own later work cannot drift to the host's default (free) model.
md5: 7c41e9b0a3d24f6815c2ab7e90d31f58
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Goal

Close the hole through which a FREE model enters a pinned robot run: when a prompt names a model
(`input.model` — the dispatch pin), that model must be FILLED into the session layer, and every
later reader of the layer must answer with the pin. Side calls that legitimately use another model
(title, summary) must stay declared choices, never an accidental default.

## Evidence (2026-10-13, read-only)

- **Session `ses_ecaff2265ffeiUGBdGYP6W47OC`** (`robot-wave:inst-cmd-runner-launch`), `dbread` of
  `.opencode/data/opencode.db`: 8 assistant rows, two models — 4 × `deepseek/deepseek-flash`
  (the dispatched prompt, all four) and 4 × `opencode/muse-spark-1.3-contributor-free` (the three
  prompts typed after the host restart). User rows carry the same split:
  `deepseek/deepseek-flash (variant max)` on the dispatch prompt,
  `opencode/muse-spark-1.3-contributor-free (variant high)` on the three later ones.
- **The session layer held the free model**: `.opencode/data/sessions/ses_ecaff2265ffeiUGBdGYP6W47OC.jsonc`
  → `agent.build_mode.model = "opencode/muse-spark-1.3-contributor-free"`. The worktree layer
  `.opencode/data/state/model.json` → `workspaceAgent.default.build_mode` = the same pair (the host's
  agent default — the TUI footer «Build · Muse Spark 1.3 Free»).
- **The pin never reached the layer**: `createUserMessage` (`packages/opencode/src/session/prompt.ts:988-1012`)
  resolves `fromSession = input.model ?? sessionWorkspaceModel` and, when `input.model` wins, uses it
  for that message only — nothing writes it into the session layer. Every later prompt without a model
  (or a TUI that shows the session's own model) therefore reads the layer: the free default.
- **Side calls are declared**: title → `title_agent` declaration or the session provider's small model
  (`prompt.ts:354-360`); compaction/summary → `lastUser.model` (`prompt.ts:2789`, `2749`) — i.e. the
  session's own model, which this fix makes the pin.

## Rules carried from the delegation (owner, 2026-10-13)

- Commit ONLY this plan's paths; `git add <path>…`, never `-A`. `_progress_log.md` is shared — append one entry.
- Tests: from `packages/opencode`, ONE file per call, through `cmd_runner`; read the run's `state.json` and the whole log.
- A red test is first a question about the TEST against the requirement — never weaken it.
- Never touch `bin/`; never `--no-verify`.

## Deliverables

- `packages/opencode/test/session/prompt.test.ts` — the pin regression (RED on the current code).
- `packages/opencode/src/session/prompt.ts` — `createUserMessage` fills the session layer from the
  prompt's named model (reusing `loadSessionSettings` / `saveSessionSettings` / `withSessionAgentModel`).
- Plan moved to `plans_completed/`, `_progress_log.md` entry, `svm render`, one commit naming the plan.

## Smoke Tests

1. **RED first:** `bun test test/session/prompt.test.ts -t "pins the session layer"` on the UNCHANGED
   source → FAIL at «the layer holds the pin», with the layer still on the pre-seeded default.
2. **GREEN:** the same run after the fix → all PASS (pin written; a later modelless prompt resolves
   the pin — `test/test-model`, not `test/other-model`).
3. **Regressions:** `bun test test/session/session-settings-smoke.test.ts` (T4/T5 layer contract),
   `bun test test/session/fill-layers.test.ts` (fill purity), `bun test test/session/session-settings-persist.test.ts`.
4. **Typecheck:** `bun typecheck` in `packages/opencode` → exit 0.
5. **Build:** `pwsh -NoProfile -File _build.ps1` from the repo root through cmd_runner → exit 0.
6. **No-drift control:** the test asserts the session FILE (read back through `loadSessionSettings`),
   not the in-memory value — a write that never lands fails the test.

## Claims

- C1 ✓ CONFIRMED (dbread, session file): the four free-model rows answered prompts 2-4 of the robot
  session; the session layer held the free pair while the dispatch pinned deepseek —
  the pin was used per-message and never written to the layer.
- C2 ✓ CONFIRMED (source, `prompt.ts:1004-1012`): when `input.model` wins, no session-layer write
  happens on any branch; `resolveAgentModel` reads S2 → S1, so a stale-but-present layer beats the pin.
- C3 (falsifier): if, after the fix, a later modelless prompt still resolves the layer's old default,
  the fill did not land — claim refuted, plan stays open.

## Risks

- **R1 — write amplification:** the pin write is skipped when the layer already holds the pair, so an
  unchanged model (the TUI's own prompt) causes no disk churn.
- **R2 — variant clobber:** the write uses `withSessionAgentModel` (fill semantics — copies model, and
  a variant only when the prompt names one), NOT `setSessionAgentModel` (which pins the `default`
  variant sentinel and would silence a picked variant).
- **R3 — a caller that intentionally uses a one-shot model:** its pin lands in the layer; the next
  prompt that names no model keeps it. That is the intended contract («the last declared model wins»),
  and a deliberate change is an explicit prompt/model or a TUI pick.

## Rollback

`git revert` of this plan's commit — the change is confined to `createUserMessage` and one test block.

## Tasks

- [x] **S1 — RED.** Pin regression in `test/session/prompt.test.ts`: seed the session layer with a
      default, prompt with a named model, assert the layer holds the pin, then prompt WITHOUT a model
      and assert it resolves the pin. ✓ CONFIRMED (cmd_runner `20261013T143411Z_eecf9199`, exit 1, 1 fail:
      the layer still held `test/other-model`). <!-- sv: red-test,prompt-pin,session-layer -->
- [x] **S2 — Fix.** `createUserMessage` loads session settings once, passes them to `resolveAgentModel`,
      and when `input.model` is present fills S2 (`withSessionAgentModel` + `saveSessionSettings`)
      unless the layer already holds the pair; failure is logged, never silent.
      ✓ CONFIRMED (same filtered run after the fix: `20261013T143514Z_0e3a5462`, exit 0, 1 pass / 0 fail).
      Contract fallout: the old `applies agent variant only when using agent model` test encoded
      «a named model does NOT persist»; it now carries the pin step (all three variant assertions
      kept, one added). <!-- sv: session-layer-fill,prompt-model-resolution -->
- [x] **S3 — GREEN + regressions + typecheck.** ✓ CONFIRMED (cmd_runner state.json + full logs):
      full `prompt.test.ts` `20261013T144245Z_99ac2edc` — 44 pass / 13 skip / 0 fail, exit 0;
      `session-settings-smoke` 6/0 `20261013T143533Z_c95ede2b`; `fill-layers` 19/0
      `20261013T143552Z_4404fb93`; `session-settings-persist` 28/0 `20261013T143600Z_fad1b92a`;
      `bun typecheck` exit 0 `20261013T144509Z_4a9de21b` (final text) and `20261013T144018Z_7f4c1e55`.
      HARNESS note (2 runs, replication 1/2 → 2/2): the first full-file run `20261013T143728Z_9859326f`
      had 4 `ENOENT …\configs\.gitignore` failures — the shared `.temp/test/` was cleaned under it
      (documented class); the same 4 passed on the rerun. <!-- sv: green,regression,typecheck -->
- [x] **S4 — Close.** ✓ CONFIRMED: `_build.ps1` `20261013T144532Z_9dae9d2f` exit 0 (smoke 10.0.1314,
      embedded prompt PASS, `[OK] Build complete - artifacts in dist/`); `_progress_log.md` entry carries
      every run id; plan moved to `plans_completed/`; `svm render` regenerates `plans/MASTER_PLAN.md`
      with this plan; the closing commit names the plan. <!-- sv: build,progress-log,master-plan,commit -->
