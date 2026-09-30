# Drop `presence_penalty` / `frequency_penalty` from what opencode sends

<!-- intention: the request body carries presence_penalty/frequency_penalty (deprecated no-ops at the vendor, and one half of a pair the server rejects with 400) -> opencode sends neither; repetition_penalty (a live parameter on those vendors) stays -->

- **plan_id:** 2026-09-30_drop-penalty-sampling-params
- **revision:** 1
- **state:** ACTIVE (S5 open — owner's live confirmation)
- **owner decision:** «Честно убери presence_penalty и frequency_penalty.» (2026-09-30)

```yaml
Keywords: sampling-penalties 0.30, zen-400 0.22, upstream-parity 0.18, wire-body 0.14, deprecated-params 0.10, plan-binding 0.06
Semantic dominant: Our default sampling sent presence_penalty together with repetition_penalty, which the Zen-backed vendor rejects with a 400; the pair is removed so our body matches upstream.
md5: 7c1f4a9e2b6d38f05a4c1e7d92b06f31
prev-md5: b95e2d0b954c5f1d1205c7b471e3f82e
parent-goal-md5: d99945d67a57440775f414e816c78773
```

## Why (G1 evidence)

Owner's Zen key authenticates (it works on upstream 1.18.29) but our TUI answers:

```
Upstream request failed: [invalid_request_error] repetition_penalty can't be
combined with frequency_penalty or presence_penalty
```

`invalid_request_error` is a **400 on the request body** — key, endpoint and
transport are all fine; the request reached the vendor's parameter validator and
was refused there. ✓ (error text, owner's session 2026-09-30)

An earlier reading of this session blamed the auth path (`Global.Path.config` =
`exeDir` vs upstream's `Global.Path.data` = `~/.local/share/opencode`) and the
gateway. Both divergences are real, **neither is this failure** — a request that
gets a body-validation error has already authenticated. ✓ (error semantics)

### Sources, converging

1. **Upstream 1.18.29 sends NEITHER penalty.**
   `grep -rE 'repetition_penalty|repetitionPenalty|presencePenalty|presence_penalty' external/opencode-1.18.29/packages/opencode/src` → no matches.
   Control on the same tree (`temperature|topP`) → 17 matches, so the absence is a
   property of the code, not of the filter. Upstream builds params at
   `session/llm/request.ts:124-127` with `temperature` + `topP` only. ✓ (grep + control)

2. **DeepSeek official API reference** (`api-docs.deepseek.com/api/create-chat-completion`
   — the vendor Zen routes `/chat/completions` models to, and this session's model
   DeepSeek V4.1 Flash maps to `https://opencode.ai/zen/v1/chat/completions` +
   `@ai-sdk/openai-compatible` per the Zen docs):
   - `frequency_penalty` — **deprecated**: "This parameter is no longer supported.
     It will not take effect if you pass it to the API."
   - `presence_penalty` — **deprecated**: same wording.
   - `repetition_penalty` — **absent from the documented parameter table**;
     documented samplers are `temperature` and `top_p`.
   ✓ (official docs fetched 2026-09-30)

3. **OpenCode Zen official docs** (`opencode.ai/docs/zen`): Zen dispatches per-model
   to `/zen/v1/responses` (`@ai-sdk/openai`), `/zen/v1/messages` (`@ai-sdk/anthropic`),
   `/zen/v1/chat/completions` (`@ai-sdk/openai-compatible`), and publishes metadata at
   `https://opencode.ai/zen/v1/models`. ✓ (official docs fetched 2026-09-30)

**Withdrawn premise:** the exact validator that emits the string was reported by a
code search as `vllm-project/vllm → sampling.rs`, but `vllm/sampling_params.py` carries
only range checks and a second code search returned nothing. The vLLM attribution is
**Guess** and is not a premise of this plan — the fix does not rest on it.

### What we currently send

Ours carries both penalties on every request:

| site | fact |
|---|---|
| `src/session/model-sampling.ts:8-13` | `DEFAULT_MODEL_SAMPLING` = `temperature 0.65, repetition_penalty 1.1, top_p 0.95, presence_penalty 0.2` |
| `src/session/model-sampling.ts:23-35` | `modelSampling()` falls back to the default for any absent/invalid value → both penalties always defined |
| `src/session/llm.ts:655` | `presencePenalty: input.agent.presencePenalty ?? sampling.presence_penalty` |
| `src/session/llm.ts:876` | `presencePenalty: params.presencePenalty` → wire `presence_penalty` |
| `src/session/llm.ts:598` | `mergeDeep({ repetition_penalty: sampling.repetition_penalty })` → wire `repetition_penalty` |
| `src/agent/agent.ts:329,365,400,458,484,530` | per-agent `presencePenalty` |

## Decision

Remove `presence_penalty` and `frequency_penalty` **from our whole assembly** —
sampling model, agent declarations, request params, config schema, TUI dialog and
the `aicall` schema. `repetition_penalty` stays: it is not deprecated, and with the
pair gone it is no longer one half of a rejected combination.

`DEFAULT_MODEL_SAMPLING` is the TUI's model-wide default (read by
`cli/cmd/tui/context/local.tsx`, `dialog-model-parameters.tsx`), so the field is
removed at the model, not merely filtered at the wire — a second spelling of a
removed knob is the defect, not a fix.

## Tasks

- [x] P1 `src/session/model-sampling.ts` — field dropped from interface, defaults, parser
- [x] P2 `src/session/llm.ts` — both `presencePenalty` params dropped (655, 876)
- [x] P3 `src/agent/agent.ts` — schema field, the 5 declarations, the config merge dropped; per-identity comment re-worded
- [x] P4 `src/config/provider.ts` — `presence_penalty` dropped from `Model.sampling`
- [x] P5 `src/cli/cmd/tui/component/dialog-model-parameters.tsx` — FIELDS row dropped
- [x] P6 `src/tool/aicall.ts` — both params dropped from the schema and the mapping
- [x] P7 tests moved in the SAME change (3 files; one new invariant added)
- [x] P8 typecheck + focused tests PASS
- [ ] S5 LIVE end-to-end confirmation — the only criterion measured against the owner's original
      goal: after the rebuild, one ordinary message on a `chat/completions` Zen model streams a
      reply instead of `400 invalid_request_error`. The agent cannot run it (it needs the owner's
      key in their TUI), so it stays open and the plan stays in `plans/`. The unit tests prove OUR
      request body no longer carries the pair; they cannot prove the vendor accepts the rest of it.
      **Lift signal:** one message, one reply. attempts: 0 · last_failure: not run — blocked on the
      owner's key, not on code (the rebuilt binary is promoted, 2026-09-30 19:02:33)

## Smoke Tests

| # | oracle | before | after |
|---|---|---|---|
| S1 | `bun test test/session/model-sampling.test.ts` + `subagent-sampling` + `session-settings-persist` (cwd `packages/opencode`) | 35 pass / 0 fail / 98 expect, exit 0 — run `20260930T101037Z_43a8d440` | **36 pass / 0 fail / 105 expect, exit 0** — run `20260930T101208Z_ffe26266` |
| S2 | `bun typecheck` = `tsgo --noEmit` (cwd `packages/opencode`) | (not separately run) | **exit 0, zero diagnostics** — run `20260930T101221Z_ad011f5f` |
| S5 | live request on a `chat/completions` Zen model (owner TUI) | 400 invalid_request_error | **[ ] OPEN — awaiting the owner's live message; the rebuilt binary is promoted (2026-09-30 19:02:33). See box S5.** |

S2 is the completeness oracle for this change: `keyof ModelSampling` and the agent
schema are typed, so a missed consumer is a compile error, not a silent field.

## Tool defect found during this change — REPRODUCED, countermeasure due

During the plan-file update, `multiedit` reported «Could not find oldString in the file after
normalized matching» for the second of two edits and **applied the first anyway**, while the
header of this plan was already mutated. Reproduced deliberately the same day
(`experiments/2026-09-30_multiedit-partial-apply/`), 3 probes, files read back with `read`:

| probe | edits, in order | report | file state |
|---|---|---|---|
| P1 | valid, then impossible | failure | **first edit IS on disk** — report contradicts the state it left |
| P2 | impossible, then valid | failure | nothing changed — the loop does stop at the failure |
| P3 | valid, valid | success + both diffs | both applied (control) |

Mechanism, read from `src/tool/multiedit.ts:47-60`: a plain sequential loop calling
`editTool.execute(...)`, which **writes the file immediately**, closed with `.pipe(Effect.orDie)`
(line 88). No snapshot, no buffer, no `try`, no restore — so the atomicity the tool's own
description promises («If any edit fails … **none are applied** — the file is rolled back to its
original state») **is implemented nowhere**, and the failure report is incomplete by construction:
it names the failing edit and stays silent about the writes already landed.

**This is the SECOND recorded occurrence, so @KAIZEN forbids another workaround.** The first is
`_progress_log.md` 2026-09-29, verbatim: «`multiedit` twice reported «Could not find oldString …
none applied» while 2–4 of its edits WERE in the file — read STATE after any edit, never the
report». The response recorded then was a habit, not a repair; this run paid for it a second time.
`glob packages/opencode/test/tool/multiedit*.ts` → no files: the tool has **no test at all**, which
is why a false contract could stand this long.

Mechanical danger: an agent reacting to the report by retrying the whole `multiedit` re-applies the
edits that already landed (silent duplication, or a mangled file once the anchor moved), and the
landed hunks are mutations the agent does not know it made.

**Countermeasure (next change, not this one):** make the contract true — dry-run every edit against
an in-memory buffer, abort naming WHICH edit failed while asserting nothing was written, then write
once — reusing `edit.ts`'s existing matcher rather than a second copy of it; plus the tool's first
test carrying these three probes as regressions. `applypatch` advertises the same atomicity and its
implementation was NOT read — **Unknown**, name it so the next cycle checks rather than assumes.

## Risks

- **R1** A stored `presence_penalty` in session/worktree sampling settings is now
  ignored (it is dropped by `modelSampling()`), not an error. Accepted.
- **R2** `config/provider.ts` `Model.sampling` is a closed struct; a hand-written
  config or catalog carrying `sampling.presence_penalty` would no longer decode.
  Checked: no file under `src/provider/models/` carries the key.
- **R3** Dropping the `pp` axis in `subagent-sampling.test.ts` — the "verifiers are
  sampled tighter" invariant survives on `temperature` and `repetition_penalty`
  (verifiers pinned at `1`). Superseded with provenance, not weakened to go green.

## Rollback

`git revert` of the single commit; no data migration, no schema version bump.
