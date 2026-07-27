# Mode transition guardrails

## Context / goal

Restore the mode contract: Plan, Build, and Reasoning receive their exact
instruction only at an explicit mode transition. During steady state,
software permissions and session state enforce the selected mode. Preserve the
Layer-1 synthetic compaction protocol, which is permitted only after a
completed assistant turn and is not a mode instruction.

## Prior art

reuse: N/A — this is a narrowly scoped correction to the repository's own
mode-transition and compaction protocol. No `universalsearch` capability is
available in this workspace.

## Implementation steps

- [x] Record focused test baselines.
- [x] Remove steady-state mode and generic task-continuation prompt injection.
- [x] Preserve only explicit mode-entry messages and the completion-gated
  Layer-1 compaction protocol.
- [x] Add regression coverage for the injection contract and reasoning-mode
  software permissions.
- [x] Run focused tests and package typecheck; reconcile this plan.

### Transition ownership

- UI agent selection is an explicit entry transition when the target user
  message has no preceding mode, or a different preceding mode.
- `plan_exit`, `reasoning_enter`, and `reasoning_exit` persist only the target
  agent message. `SessionPrompt.insertReminders()` attaches the one exact mode
  instruction, idempotently, from the previous-mode → current-mode transition.
- Layer-1 `injectSummaryRequest()` and its completion-gated resume remain the
  only compaction-owned synthetic conversation transitions.
- Generic post-compaction reminders, history-inferred build switches, and the
  generic user wrapper are prohibited: none has a transition owner.
- Background-job and tool-result synthetic parts are allowed only as factual,
  data-bearing representations of an explicit runtime event; they must not
  contain behavioral steering.

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `bun test --timeout 30000 test/session/prompt.test.ts` (`packages/opencode`) | pass | Timed out externally after 244 s with no Bun result; investigation required before a full-suite claim. |
| 2 | `bun test --timeout 30000 test/session/compaction.test.ts` (`packages/opencode`) | 73/73 pass | 73 pass, 0 fail [Exact] |
| 3 | `bun test --timeout 30000 test/session/system-compose.test.ts` (`packages/opencode`) | 12/12 pass | 12 pass, 0 fail [Exact] |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | `bun test test/session/mode-transition.test.ts` (`packages/opencode`) | one-shot mode transition and prohibited legacy injections pass |
| 2 | `bun test test/session/prompt.test.ts --test-name-pattern "Layer-1 summary runs after a completed answer and resumes the agentic flow"` (`packages/opencode`) | completion-gated Layer-1 resume passes |
| 3 | `bun test test/session/compaction.test.ts` (`packages/opencode`) | 73/73 pass; completion-gated compaction remains intact |
| 4 | `bun test test/session/system-compose.test.ts` (`packages/opencode`) | 12/12 pass; stable prefix composition remains intact |
| 5 | `bun test test/agent/agent.test.ts --test-name-pattern "reasoning agent software guardrail"` (`packages/opencode`) | Reasoning permits only `memory` and `reasoning_exit` |
| 6 | `bun typecheck` (`packages/opencode`) | exits 0 |

### Gate

- [x] Smoke requirements written.
- [x] Baseline recorded [Exact].
- [x] Implementation only after baseline.
- [x] Post-implementation smoke passed before completion.

## Verification [Exact]

- `mode-transition.test.ts`: 2 pass, 0 fail (12 expectations).
- Targeted Layer-1 completion/resume prompt test: 1 pass, 0 fail.
- `compaction.test.ts`: 73 pass, 0 fail.
- `system-compose.test.ts`: 12 pass, 0 fail.
- Targeted reasoning software-guardrail test: 1 pass, 0 fail.
- `bun typecheck`: exit 0.
