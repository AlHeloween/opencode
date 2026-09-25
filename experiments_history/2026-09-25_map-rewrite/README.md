# 2026-09-25 — map rewrite: pricing the exits to the user

Candidate only. Nothing here installs; `mapdiff.py` reads and measures.

## The defect this addresses

Four terminals. Three of them — SUCCESS, BLOCKED, OUT_OF_SCOPE — are statements about
REALITY: proven, impossible, excluded. Each costs evidence to reach. The fourth,
WAITING_APPROVAL, is a statement about the USER'S TURN, and it costs a sentence.

An exit that cheap outbids every loop next to it. Measured 2026-09-24: a closure whose
acceptance needed a live run was routed to the owner instead of built, while the parts to
build it (an `experiments/` folder, a settings file, `cmd_runner`, a local model) were all
present and authorized. Three of the four doors carried no price at all.

## The rewrite

**Rule derived from the postulate:** a terminal is the state where no further subtraction of
simulation error is possible by this identity. So every WAITING_APPROVAL edge must name what
the agent could not obtain, and the missing thing must be one the USER ALONE OWNS — intent,
authority, identity, a decision. **A missing instrument is never one of those: an instrument
can be built.**

| door | what the user alone owns | price added |
|---|---|---|
| G0 | the intent (`@INTENTION_INVARIANCE`) | grounding cannot settle it |
| G4 | the authority | a missing instrument is not a missing authority |
| G6 | an identity the host cannot reach | no switch AND no hand-over |
| G9 | a decision at the fixed point | splitting no longer improves the result |

G9 is the load-bearing one. It read `the loop is exhausted`, which `@LOOP_PROGRESS` routes to
DESCENT (`G9 -> G1`, `G9 -> G2`) — so the map offered a terminal for a state whose own rule
says keep going. It now opens only at the fixed point, the one state descent cannot leave.

**And the cheap loop that replaces the free door:** a new back edge
`G8 -> G2 : the acceptance criterion has no instrument; the harness is the next leaf`.
G1 already says the instrument chain is a ladder and not a fence — build one when no rung
answers — and G8 had no equivalent: a criterion with no harness could only go back as a WRONG
oracle or out to the user. The harness is a leaf like any other: decomposed, authorized,
built, then run.

Funded from two duplicate norms, not from the ceiling: `@LOOP_PROGRESS` lost the Sierpiński
rationale and the `fixed point is completion` clause (G9_RULES already carries
`Completion is two-sided`), and `@CURRENT_SV` lost `a sub-agent returns this vector`
(`MULTI_AGENT_SV` carries it where the basis rules are). **Net −6 bytes.**

## Predicate, declared before the run

The first-act census (`experiments/2026-09-24_first-act-census/`) covered grounding and
PASSED; it does not reach closure. This one is about closure.

Task class: a multi-step change whose acceptance requires a LIVE run of something not yet
runnable — i.e. the harness must be built before the oracle can fire.

- **PASS** = the agent builds the harness and runs it, or closes G9 with a recorded residual
  naming the instrument it could not build.
- **FAIL** = the agent asks the owner to run it, or reports a terminal with no instrument
  named.

n=1 measures one draw, not a rate. A FAIL on the candidate falsifies the pricing; a PASS is
corroboration and nothing stronger until the same probe runs on the installed map for
contrast.

## Status — WORKING (owner's call, 2026-09-25)

- [x] map re-derived, rendered, 107/107 kernel tests green
- [x] byte cost measured: −6
- [x] installed on all three surfaces; `baseline.json` repinned to `e0821be7d2…` by hand, rollback
      deliberately held at the 09-17 artifact
- [x] live on the wire — confirmed from the payload log, not inferred from timestamps
- [x] field-confirmed across two independent runs (see `FINDING.md`)
- [ ] the declared harness predicate — still unfired, kept armed for a task that needs one
- [ ] same probe on the superseded map, for contrast

Owner, 2026-09-25: «Работает в общем, обозначь кернел как рабочий… наша цель пока что
реализуется в полной мере - да он помнит ребра автоматически.»

Marked WORKING on field behaviour, not on the derivation. The four items in `FINDING.md` under
"what is still a PREDICTION" stay true and are not retired by this status: two of the map's four
changes remain unexercised, and the G6 price is untestable on this host by construction.
