# Kernel release — 2026-09-24

Depth: L3 (graph edges, shared rules, a core rule reworded without weakening). Authorized by the
owner on 2026-09-24. Rollback point: `prompt_kernel/dist/2026-09-17_23-16-37_reasoning_prompt.txt`.

| surface | path | bytes | sha256 |
|---|---|---|---|
| product | `packages/opencode/src/session/prompt/reasoning_prompt.txt` | 46 969 | `dc981bc4…da82e2ba` |
| claude | `.claude/reasoning_kernel.md` | 46 946 | rendered from the same source |
| codex | `prompt_kernel/dist_codex/*_reasoning_prompt.txt` | 46 514 | rendered, host installs its own |
| previous production | — | 46 904 | `dabf50f3…` |
| **battle-tested base** | `dist/2026-09-17_23-16-37_reasoning_prompt.txt` | 34 580 | `f98f0f11…` |

The 09-17 artifact is the reference because it is the one with a real project run behind it. It is
byte-identical to `2026-09-16_13-21-05` (same sha), so every measurement below taken against either
is taken against the same text.

## Why — three mechanisms, measured

| | 09-17 | before this release | now |
|---|---|---|---|
| G0+G1, read and satisfied BEFORE the first call | 2 840 B | 7 309 B (×2.6) | **5 365 B** |
| G1 alone | 2 125 B / 15 bullets | 6 396 B / 32 | 4 644 B |
| total | 34 580 B | 46 904 B | 46 969 B |

1. **The pre-action section tripled.** An imperative that is not a call can only be satisfied by
   PROSE, so mass moved forward in the pass buys narration instead of grounding. A third of G1 was
   catalogues that help *build* a surface and never help *find* one.
2. **The enumerated instrument chain read as a FENCE.** A closed list makes "instrument" mean "one
   of these host tools", so an agent that finds no listed tool reaches for the most impressive one
   it cannot steer — a 3D environment, or the built application. On 09-17 there was no list, and the
   agent did the obvious thing: take the project's own reading module, apply a filter, get an array.
3. **A non-PASS had no forward edge.** `UNKNOWN_ROUTING` says an Unknown claim routes FORWARD to
   G9; the map offered only the two back edges. That circle *is* what a STALL was. `loop_budget` had
   no value anywhere, so the STALL terminal's earliest legal firing was the first retry.

## What changed

**Evicted** (to `docs/ui-standards.md`, one pointer left at G7): GUI, TUI, ergonomics and
project-shape catalogues — 1 624 B. **Moved**: `ACCEPTANCE_FRAME` G1 → G3, where "before planning"
is satisfied literally. **Removed as duplicate**: the V&V line (carried by `@ORACLE` +
`@INTENTION_INVARIANCE` + G9 `ACCEPTANCE_PASS`), the restatement of divergence inside
`ORACLE_STAMP_RULE`, and two lines of economy commentary.

**Graph** — the owner's loop, landed as edges rather than prose:

- `G1 → G2` now carries its two senses apart: *grounded on instrument results, or on an established
  absence* and *not groundable at this scale: split until a leaf is observable*, returning through
  the new back edge `G2 → G1`. Decomposition is an instrument of grounding, not its reward.
- `G8 → G1` (new): an unrealistic oracle is a grounding defect, not a plan defect.
- `G8 → G9` (second forward): a recorded non-PASS whose loop budget is exhausted; closure decides.
  The `G8 → WAITING_APPROVAL` terminal is gone and `validate.py` now refuses any terminal edge from
  G7 or G8 — after mutation begins, G9 is the only lawful exit.
- `G9 → WAITING_APPROVAL` (new): STALL, where only the user can move it.
- `G1 → BLOCKED` widened: the question is unobservable at every scale.

**Rules**

- `@ORACLE` is now a definition with five required properties: it can fail (an instrument that
  cannot fail proves nothing — core clause kept verbatim), it sits on the claim's LAYER, its
  predicate EXCLUDES the alternatives, it returns an ADDRESS, and this identity can DRIVE it. A
  build or whole-app run fails the last three; running an application proves that it runs.
- `@GUESS_DECIDES_NOTHING` (new shared): an ungrounded passage is error ADDED; promote each Guess a
  decision rests on through the primary authority of its class, then code, then smoke — or close it
  Unknown. This is the first caller `@SOURCE_ROUTING`'s 67 authorities have ever had.
- `@LOOP_PROGRESS`: a pass adding no instrument result, no claim and no residual is charged as a
  retry (`@REASONING_MODE` exempt, and an established absence does not burn one).
- `G1 INSTRUMENT_ORDER`: the chain is a ladder, not a fence — when no rung answers, BUILD the
  instrument from the project's own parts.
- `G1 INSTRUMENT_LAYER`: your own context is the nearest instrument and the least decisive.
- `G0` emits the Digital Intention and nothing else; `STATE_FIRST` moved to G1.
- `G2 CUT_UNSUPPORTED`: cut before planning — what evidence does not support leaves the answer.
- `G4 APPROVAL_EXTENT`: an ALLOW binds to the GOAL, not to a task or a revision.
- `G6 HANDOVER_OR_SWITCH`: switch or hand over where the host allows it and continue at G7; the
  terminal is only for a host where neither is possible.
- `G7 PLAN_EXECUTION`: the per-task record lands in the log and the plan box, never in the reply.
- `@COMPACTION_CADENCE`: after a fold the first act is an instrument call that re-reads a handle —
  the plan comment, the progress log, a `path:line` — never a summary of the summary. The fold
  deletes the only part of the window that demonstrates instrument use, so it has to be re-made.
- **Termination is a FIXED POINT, not a scale limit** (owner: «фракталы бесконечны»). `@LOOP_PROGRESS`:
  exhaustion means the scale is wrong — descend, re-ground the leaves, build a leaf's instrument, and
  repeat while each split IMPROVES the achieved result; that gain is the descent's measure, since
  scale alone divides forever. **A split that reproduces the parent's structure gains nothing BY
  CONSTRUCTION** — the Sierpiński test, which proves the stop instead of measuring it once
  (owner: «сколько ты этот круг не раскладывай — он кругом и будет»). G9 `CLOSURE_PROOF_RULE` states it two-sided
  (owner: «нечего добавить, нечего убавить — perfect form»): **no split adds, and nothing present
  lacks support**. Both derivatives zero — void-filling from one side, `CUT_UNSUPPORTED` from the
  other — and the remainder is recorded as residual: finished, not abandoned.
- `RESIDUAL_GOAL` gains `form_holds` (owner: «любая не perfect form перечёркивает любую мудрость с
  точки зрения продукта»). Wisdom and form MULTIPLY, so a small residual can still leave a fragment,
  and a fragment is worth nothing whatever reasoning produced it. Encoded as a SLOT, not a sentence —
  13 bytes, and the field has to be filled, which forces the judgement an imperative only requests.
- `@INFORMATION_STATUS`: Unknown is not a destination — it reports that the SCALE is too coarse.
- `@EVIDENCE_BOUNDED_CLOSURE`: everything delivered carries its oracle and the uncovered part of the
  intent is named as residual; **a partial REAL result outranks a complete simulated one**.
- `loop_budget` is derived, not hardcoded: the envelope's value, else the count of distinct declared
  routes out of that gate (G8 three, G9 two, G2 and G5 one). It counts DISTINCT attempts — the same
  instrument twice is already a STALL under `UNKNOWN_ROUTING`. An established absence does not burn
  a retry, or the rule would reward acting without grounding.
- `G9`: the plan moves by the OUTCOME — SUCCESS → `plans_completed/`, OUT_OF_SCOPE →
  `plans_deferred/`, BLOCKED and WAITING_APPROVAL → `plans/postponed/` with the reason and the
  signal that lifts it. `plans/` is legal only while the plan owes work.

## Procedure (docs/kernel-amendment.md)

1–2. Proposal and NO_DUPLICATE_NORM — `plans_completed/2026-09-24_grounding-first-and-boundary-reporting.md`;
every addition either replaced a norm or merged into one. 3. Constitutional check — **the core is
identical to 09-17**: same 8 rules, same 8 pinned clauses, verified by diff. 4. Impact — G0–G9 rules,
5 edges, 1 shared rule, 3 addon registries, `validate.py`. 5. Constitutional tests — green before and
after, 107 passed. 6. Authorization — the owner, 2026-09-24. 7. Version stamp — `baseline.json`
carries the new sha, the previous one and the rollback artifact. 8–9. Freeze and rollback — the
09-17 artifact and every intermediate render stay in `dist/`.

## Not verified — read this before trusting the release

- **No behavioural oracle has run.** The claim "grounding happens first again" is Inferred. Its
  falsifier is named and cheap: over the session store, the share of user-task turns whose FIRST
  assistant part is a tool call. Baseline not yet taken.
- **The shipped `bin/opencode.exe` carries an Unknown prefix.** Grep for the new strings returns
  zero, but so does the control (`DIGITAL_INTENTION`, `INFOMARK`), so the kernel is not plaintext in
  the executable and the predicate has no power. Promoting a build is the owner's act.
- The prose compression pass is open; the worklist is `experiments/2026-09-24_kernel-prose-census/`.
- **External review, 2026-09-24 (post-release): the six previously named objections no longer
  reproduce and no new ones were raised.** Read it for what it is — a falsifier that did not
  falsify. Under `DELEGATION` an isolated model call may only FALSIFY, never stamp, so agreement
  moves nothing; and the reviewer reads the PREFIX, which says nothing about behaviour. It is a
  regression check over a named list, not evidence of quality.

## The ceiling is now the binding constraint

product 46 969 / 47 000 — **31 bytes free**. Everything in this release was funded from evicted
catalogues and removed rationale prose; there is nothing left to give without a decision:

| lever | worth | whose call |
|---|---|---|
| the prose compression pass | 58 unpinned rules, 4 543 B of tail — worklist in `experiments/2026-09-24_kernel-prose-census/` | owner |
| `@SOURCE_ROUTING` secondary routes (33 entries) | 525 B; the norm says enter the PRIMARY of the class, so the secondaries have no caller | owner |
| raise `KERNEL.utf8_budget` | any | owner, and against the standing rule |
