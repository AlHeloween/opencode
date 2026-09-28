<!-- intention: a live fold labelled a token-measurement session with a plan-shelf-triage goal, so the next cycle would inherit a goal the owner never set -> every folded window names only a goal its own coupling supports, and the sv meter reports absence over the window instead of only in the last reply -->

# Fold carrier integrity — Goal linkage and the sv meter's blind spot

Status: DRAFT (lifecycle ACTIVE). Four tasks, all small, all grounded at path:line.

## Why this plan exists

A deliberate `compact` on 2026-09-26 (run at 13% of the fold threshold) produced a head
whose `--- Goal ---` named `plans/2026-09-24_to-be-confirmed-shelf-triage.md` while the
session had done token-traffic measurement. Measured: ONE session named THREE plans in
three places —

| source | named |
|---|---|
| `next:` in compaction-status | `2026-09-26_unified-settings-layers` TASK-8 |
| the fold's Goal carrier | `2026-09-24_to-be-confirmed-shelf-triage` |
| what the session did | token measurement, no plan at all |

The mechanism that decides what the head says about the session picked "some plan that has
an intention" instead of "the plan this window is working".

## Premises (each with its instrument)

P1. The Goal carrier is a deliberate two-source design, not an accident —
    `packages/opencode/src/session/compaction.ts:1579` ("READ, never derived"),
    `:1587` (the owner's own words), `:1590` (Unknown when neither answers),
    `:1619` (the Unknown line). ✓ read at those lines, 2026-09-26.
P2. The Unknown fallback is unreachable whenever ANY plan carries an intention —
    `:1600` emits the plan line unconditionally when `plan.intention` parses, and only
    `:1619` is guarded by "neither carrier answered". ✓ read, 2026-09-26.
P3. The plan↔window coupling count is ALREADY computed in the same block and is not
    consulted by the Goal carrier — `:788` `coupling: ${input.coupling.checked} vector(s)
    with a plan link`, while `buildGoalLines` (`:1579`-`:1619`) takes no coupling input.
    ✓ grep + read, 2026-09-26.
P4. The sv meter already reports ABSENCE for the last reply — `:832`-`:834`, with the
    rationale at `:825`-`:827`. It has no window-wide ratio, unlike the marks line at
    `:822` (`${m.unmarked}/${m.replies}`). ✓ read, 2026-09-26.
P5. Measured slip: two replies in the observed window (#52, #54) carried no vector, and
    the meter never surfaced them because later replies carried one. The fold's Table of
    contents is an index of the vector chain, so those replies are invisible to it. ✓
    fold observation + `messagesearch dominants`, 2026-09-26.

## Claims and falsifiers

C1. Gating the plan-intention line on `input.coupling.checked > 0` makes the goal
    accurate for uncoupled windows.
    Falsifier: a window that genuinely works a plan but has not yet emitted a coupled
    vector loses its plan goal and falls back to the owner's words. That is the intended
    trade, but it must be visible — so the fallback line must say WHY, not silently swap.
C2. Adding `${n}/${m} window replies without a vector` to the sv line catches a mid-window
    gap that the last-reply form cannot.
    Falsifier: the ratio is already derivable from an existing line, making the addition
    cosmetic.

## Tasks

- [ ] **T1 — Gate the plan goal on coupling.**
      In `buildGoalLines` (`compaction.ts:1579`-`:1619`), accept the coupling count
      already available to the caller (`:788`). Emit the plan-intention line only when the
      window is actually coupled to that plan; otherwise fall through to the owner's words
      and, failing that, to the existing Unknown at `:1619` — with the reason stated in
      the line. Do NOT derive a goal from the Table of contents: P1 forbids it
      ("READ, never derived").
- [ ] **T2 — Window-wide absence in the sv meter.**
      At `compaction.ts:828`-`:836`, mirror the marks line: keep the last-reply verdict
      and append `· N/M window replies without a vector`.
- [ ] **T3 — Give the ranges line an ADDRESS instead of "unavailable".** ADDED after
      `docs/compaction.md:56-78` was read: the failure it names is losing information
      "without leaving a marker where the loss occurred … absence has no
      representation", and what this design preserves instead is ADDRESSABILITY
      ("paging: the working set shrinks, the address space does not"). The fold's
      `summaries: positions unavailable in this render` and `continuity: not verifiable
      here` are therefore an absence WITHOUT an address — inside the contract, not a
      doctrine change. Fix shape: print the resolvable address for the folded region
      (`sessionread --offset/--limit`, or the message-id range) instead of the word
      "unavailable", so a message absent from the ToC and the tail is still REACHABLE
      from the head. Verified reachable today: `sessionread offset=20 limit=11`.
      oh-my-pi has the reusable marker shape — in-band, naming what was dropped and how
      much (`: omp-debug-elided chars=…`, `: omp-debug-truncated originalChars=…` in
      `packages/tui/src/apps/debug/raw-sse-buffer.ts`).

- [x] **T4 — The Goal carrier must not quote a machine artifact as the owner's request.** ADDED
      2026-09-27, from a measurement rather than a reading.
      **Measured (`dbread` on the live session, range #780..#875):** the first `user`-role row is
      `msg_0e15e0798001SM4jw3ldjz7W9d` with `synthetic = 1` and text `=== LAYER-1 SUMMARY === …` —
      the panel this system writes. `compaction.ts:1430` was
      `rows.find((r) => r.role === "user")` with **no filter**, so the row printed
      `In this range the user asked: === LAYER-1 SUMMARY ===`, asserting the owner asked for a
      summary marker. It reached two rows and I repaired both **by hand** — the tell that a carrier
      is wrong: a reader can fix it, and the next reader will not know to. Meanwhile `--- Goal ---`
      in the fold head names the real request (`#781 «Что у нас на повестке?»`), so two carriers of
      one fact disagreed and only one was correct.
      **This is a MISSED APPLICATION, not a missing concept:** `isLayer1SummaryText` is already
      applied in five other walks (`compaction.ts:275`, `:528`; `prompt.ts:842`, `:1698`, `:1965`).
      The sixth walk was the only one that writes what the next cycle inherits.
      **Claim C3.** Filtering the machine artifact out of the `firstUser` selection makes the Goal
      name the owner's actual request. **Falsifier:** a range whose only `user` message is the panel
      then has NO request, and the old fallback («the goal is carried by the plan's `intention`») is
      reached only when no plan intention exists — so it credited a carrier that is not there. Both
      halves are asserted: the request is taken when one exists, and the absence is stated when it
      does not (Acceptance #5's second clause).
      **Artifact** — baseline RED `20260927T130231Z_4328078e` (13 pass / **2 fail**, the two new
      tests); GREEN `20260927T130301Z_e507dd6e` (**15 pass / 0 fail**); `bun typecheck`
      `20260927T130301Z_01c6c72b` (`state.json` exit 0, `bytes_written: 304`, 0 dropped); fold
      suite `20260927T130331Z_256c52c7` (**75 pass / 0 fail** across the five files
      `docs/compaction.md` names).

## Acceptance

1. A window with a plan file present but `coupling.checked === 0` emits a goal naming the
   OWNER'S REQUEST or `Unknown` — never the unrelated plan.
2. The sv line reports a mid-window vector gap (reproduce by omitting a vector from one
   reply with a later reply carrying one).
3. No change to `:1703` (`--- Recent ---`), `:1784` (topics), or `:1789` (ToC).
4. The ranges block no longer prints `unavailable` for a region that exists; it prints
   an address that resolves. Falsifier for the fix: the printed range does not return
   the messages it claims.
5. The `Goal` block never names a plan the window is not coupled to, AND never becomes
   silent when it declines to name one — the fallback states the reason.
6. **T4.** A range whose first `user` message is the Layer-1 panel names the owner's NEXT
   request; a range with no owner request states that none exists and does not credit a
   plan intention no plan declares. Falsifier for the fix: the machine marker appears
   anywhere in the row.

## Smoke Tests

- Baseline BEFORE T1: run a fold in a session whose active plan has an intention but whose
  window has zero coupled vectors; assert the Goal block names the plan. Record the run id.
- Post-T1: same session, same fold — assert the Goal block does NOT name the uncoupled
  plan and that the fallback line names the reason.
- Post-T2: drive two replies, omit the vector in the first, include it in the second; read
  the status line and assert the `N/M` form is present with N=1.
- `bun typecheck` from `packages/opencode` (never from the repo root).
- Focused test file, named path — never a bare `bun test`.
- Fold suite named by `docs/compaction.md`'s own reproduce block, run from
  `packages/opencode`: `test/session/summary-cadence.test.ts`,
  `test/session/cache-injection.test.ts`, `test/session/finish-step.test.ts`,
  `test/session/llm.test.ts`, plus `test/provider/balance-storage.test.ts`.
- Post-T3: assert the address printed by the ranges block resolves — read back through
  the address it printed, not through memory of the region.

## Out of scope (recorded, deliberately not in this plan)

- The `--- Window topics ---` carrier degenerates to all-1s on a short window (7 terms,
  each count 1) because it counts per-term occurrences over too few vectors. This is
  doctrine about what the carrier is FOR, so it goes to `docs/compaction.md`, not here.
- ~~Range accounting prints `positions unavailable` and `continuity: not verifiable
  here`~~ — MOVED INTO THIS PLAN as T3. Originally filed as out-of-scope on the
  assumption it was a doctrine question. `docs/compaction.md:56-78` settles it the
  other way: an absence without an address is the exact failure the contract exists to
  prevent, so printing "unavailable" is a defect against the contract, not a proposal
  to change the contract.

## Rollback

Both tasks are additive string changes inside one render function. Revert = restore the
two hunks; no state, no schema, no migration.
