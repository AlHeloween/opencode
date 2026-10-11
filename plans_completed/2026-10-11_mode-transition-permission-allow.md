<!-- intention: planenter/planexit block the user with a Question Yes/No dialog (no timeout; invisible to the permission system), so autonomous runs cannot switch modes at all and interactive runs are nagged per transition -> mode transitions are permission-gated (ctx.ask) with default allow: silent by default, `ask` restores the prompt (60 s timeout), `deny` refuses; headless run.ts stops pre-denying transitions. -->

# Mode transitions: permission-gated (default allow), no question dialog

**Status:** COMPLETED — 2026-10-11 (all boxes carry run ids; closed by the commit that names this plan). Owner, 2026-10-11, verbatim: «несколько странный момент - надо на этот запрос сделать permission да так чтобы он был по умолчанию allow, чтобы не спраишвалось перейти в режим планирования или выйти из него, потому что по протоколу это частный случай, для автономности ничего спрашиваться не должно.»

## SV

Keywords: mode-transition 0.30, permission 0.25, planenter 0.20, default-allow 0.15, autonomy 0.10
Semantic dominant: planenter/planexit stop asking via Question dialogs and become permission-gated with default allow.
md5: 7f3c9a1d54e28b0cf6d4a9172be35c88
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000

## 0. Grounding (read with instruments, 2026-10-11)

| # | Fact | Instrument |
|---|------|-----------|
| G1 | `planenter`/`planexit` are the only mode transitions that ASK the user: blocking Yes/No `question.ask` dialogs at `tool/plan.ts:86-102` and `:158-174`; "No" → `Question.RejectedError` | read (verbatim) |
| G2 | The Question service has NO timeout (`question/index.ts:174-179` — `Deferred.await` + cleanup only): an unanswered dialog hangs the tool forever. Headless `opencode run` therefore PRE-DENIES the tools (`cli/cmd/run.ts:408-424`: question/planenter/planexit all `deny`) | read |
| G3 | The keys `planenter`/`planexit` already exist in every identity ruleset (`agent/agent.ts:149,163,232-233,293-294,…`), but plan.ts never calls `ctx.ask` — the keys only act as Gate A denies (`session/tools.ts:124-167`) | read + grep |
| G4 | `reasoningenter`/`reasoningexit` do NOT ask — `tool/reasoning.ts` switches directly (Gate A + `requireNativeIdentity` only). The transition family is inconsistent: plan asks, reasoning does not | read |
| G5 | Permission semantics: allow → silent; ask → prompt with 60 s timeout → auto-reject; deny → `DeniedError`; unmatched → ask; agent defaults are `"*": "allow"` (`permission/index.ts:183-234`, `evaluate.ts:41`, `agent.ts:98-119`) | read |
| G6 | After a switch the tool writes a synthetic user message carrying the new agent + mode tail and calls `invalidatePermissionCache()`; the TUI auto-switches on the completed tool part (`tui/routes/session/index.tsx:548-560`) | read |
| G7 | Rejection parity: the processor blocks the step for `Permission.RejectedError` exactly as it did for `Question.RejectedError` (`processor.ts:864`) | read |

## 1. Claim ledger

- **C1.** `ctx.ask({permission:"planenter"|"planexit", patterns:["*"]})` is silent under defaults: build_mode→planenter and plan_mode→planexit both resolve `allow` (no matching deny; defaults `"*": allow`). *Falsifier:* a default-config session shows a dialog or fails on planenter. *Pin:* `permission/evaluate.ts:38-41` + the two rulesets.
- **C2.** The ask is restorable by config: `permission: { planenter: "ask" }` → rule `{planenter, *, ask}` (fromConfig) evaluated last → prompt with 60 s timeout. *Falsifier:* configured `ask` produces no dialog.
- **C3.** plan.ts no longer depends on `Question.Service` — the new test harness provides NO Question layer (same layer list as `test/tool/reasoning.test.ts`) and still executes both tools. *Falsifier:* init dies on an unsatisfied service.
- **C4.** Headless keeps working transitions: the planenter/planexit deny entries in `run.ts` are removed; the `question` deny stays (the question TOOL still needs a human). *Falsifier:* a run session's planenter is refused by Gate A.

## 2. Risk ledger

- **R1 (critical).** Removing the run.ts denies changes headless behavior: a `run` session may now switch modes. *Containment:* this IS the owner-requested autonomy; the switch stays ACL-gated per identity and is recorded in the transcript; rollback = restore the two deny rules.
- **R2.** Updating `plan-enter.txt`/`planexit.txt` alters provider-visible tool descriptions → one-time KV prefix change. *Containment:* accepted; new sessions only (checkpoints keep the old prefix until compact).
- **R3.** A denied transition now surfaces as `DeniedError` instead of the old question tool error. *Containment:* same class as every other tool; Gate A still refuses first.

## 3. Tasks

- [x] **S1 — tool rewire.** DONE — `tool/plan.ts`: `Question` import removed; both transitions gate via `ctx.ask` (planenter `:84-89`, planexit `:144-149`, `plan` path kept in exit metadata); comments now read "permission-gated; default allow — no dialog" (read-back verified).
- [x] **S2 — descriptions.** DONE — both `.txt` files carry "The switch is permission-gated (`planenter`|`planexit`): allowed silently by default, prompted only when configured as `ask`, refused when denied." (findstr on disk; description-integrity suite 5/0).
- [x] **S3 — headless rules.** DONE — `run.ts` session rules now deny only `question` (+ rationale comment, `:408-417`).
- [x] **S4 — test.** DONE — NEW `test/tool/plan.test.ts` (no Question layer in the harness): RED `20261011T111947Z_e8bb41bf` (0 pass / 3 fail — `Service not found: @opencode/Question`) → GREEN `20261011T112040Z_8fb04087` (3 pass / 0 fail / 8 expect; asserts permission key + patterns, the switch, and refusal-without-switch).
- [x] **S5 — oracles + build.** DONE — regressions: reasoning `20261011T112105Z_ae2378f3` 1/0; mode-transition `20261011T112105Z_985b3ec0` 5/0; agent `20261011T112105Z_0fd6142a` 51/0; description-integrity `20261011T112121Z_cdb7b7e6` 5/0; `bun typecheck` `20261011T112052Z_2e5ec067` exit 0; `_build.ps1` `20261011T112216Z_20f497bc` exit 0 (smoke 10.0.1272, artifacts staged to dist/).

## 4. Smoke Tests

- Baseline (before S1): `bun test test/tool/plan.test.ts` → EXPECTED RED on the missing behavior (current code requires `Question.Service`; the harness provides none). Run id recorded.
- Pre-existing regression baselines (before S1): `test/tool/reasoning.test.ts`, `test/session/mode-transition.test.ts`, `test/agent/agent.test.ts` → expect PASS.
- Post: plan.test.ts GREEN; the three regression suites unchanged PASS; `bun typecheck` exit 0; `_build.ps1` green.
- expected_delta: plan.test.ts fail → pass; regression suites unchanged (pass → pass).

## 5. Rollback

Reverse the hunks in `tool/plan.ts`, `plan-enter.txt`, `planexit.txt`, `cli/cmd/run.ts`; delete `test/tool/plan.test.ts`. No whole-file restore.

## 6. Closure

- Acceptance: C1–C4 stamped — C1/C2 by the green permission path (evaluate: defaults `"*": allow`, no matching deny) and config route (`fromConfig`), C3 by the Question-less harness, C4 by the run.ts diff.
- Critical risks: R1 contained (owner-requested autonomy; rollback = restore the two deny rules); none open.
- Residual: none for the requested outcome. Not measured: a live TUI answering an `ask`-configured prompt end-to-end (the permission service path it rides has its own suites). MASTER_PLAN/SVM authoring debt (2 plan SVs / 65 task SVs / 94 manifests, 2026-10-01) remains open and untouched by this change.
- Docs: new `docs/mode-transitions.md` (two gates — Gate A ACL + `ctx.ask`; planenter/planexit permission-gated with default allow; Question dialog removed 2026-10-11; reasoning transitions do not call `ctx.ask`), indexed in `docs/README.md`; `docs/reasoning-mode.md` corrected to the real owners (native `build_mode` enters, `reasoning_mode` exits, `checkstate` available).
