# Kernel amendment — the SELF_MODIFY ruling

```yaml
---
title: "How the reasoning kernel may be changed"
owner: "Local_Development"
status: "production"
surface: "prompt_kernel"
last_verified: "2026-09-13"
tags: ["prompt_kernel", "kernel", "governance", "self_modify"]
related_code: ["prompt_kernel/source.py", "prompt_kernel/validate.py", "prompt_kernel/baseline.json"]
summary: "Three depths of SELF_MODIFY, the constitution core that no depth may weaken, and the build procedure that replaces hand editing."
reproduce:
  files: ["prompt_kernel/source.py", "prompt_kernel/tests/"]
  commands: ["python -m pytest prompt_kernel/tests/ -q", "python -m prompt_kernel", "python -m prompt_kernel --install"]
  expected_outputs: ["pytest: 100 passed", "working_copy=not_updated before review", "installed=<sha256> matches prompt_kernel/baseline.json"]
---
```

The kernel prefix carries two sentences about this: changing the kernel is a build,
not an edit, and the installed `.txt` is generated. Everything else lives here,
because a rule that is paid for on every request must earn its bytes, and a
procedure consulted a few times a month does not.

## Why a procedure at all

Edits to a system of constraints have a **drift direction**. "Simplify" applied to
constraints means *fewer* constraints, never more, so the expected value of an
unguarded edit is not zero — it is negative and monotone. Each step looks
reasonable on its own; the sum is a kernel that no longer constrains.

The realistic failure is not an agent deciding to loosen the rules. It is an agent
*complying*: the user asks for a line, the agent opens the installed prompt and adds
it, because nothing told it the file is generated and the source is elsewhere.

## Three depths

| Depth | What changes | Proposer | Authorizer | Oracle | Rollback |
|-------|--------------|----------|------------|--------|----------|
| **L1 cosmetic** | wording, examples, comments — no norm changes | any agent | user or runtime ACL | diff + semantic check | previous version |
| **L2 normative** | a rule, gate, contract or edge is added, changed or removed | PLAN_MODE / user | user + runtime ACL | constitutional tests | previous version + freeze |
| **L3 meta** | the rules about rules: authority structure, gates, `action_classes`, the evidence ladder, this ruling | user only | user + external anchor | full scenario suite | snapshot + manual reset |

**L3 cannot be authorized by an agent.** An agent that authorizes a change to the
amendment procedure is rewriting the procedure by which it is allowed to change
anything — the recursion has to be cut somewhere, and this is the cut.

## Constitution core

Declared as data in `prompt_kernel/source.py` (`Kernel.constitution_core`) and checked
by `validate_kernel`, deliberately **not** rendered into the prefix: a second list in
the prose could drift from the rules it names.

- `@SAFETY_PRECEDENCE`
- `@AUTHORITY_SEPARATION`
- `@EVIDENCE_ORDER`
- `@INFORMATION_STATUS`
- `@ORACLE`
- `@SIMULATION_ERROR`
- `@PLAN_CONTRACT_ENFORCEMENT`
- `@PLAN_BINDING_ENFORCEMENT`

No depth may weaken these. They are not rules the kernel follows — they are the
conditions under which it is a kernel at all. Replacing one is an **external reset**
(a new kernel, applied by hand, outside the procedure), never a SELF_MODIFY.

The selection criterion is worth stating, because it is not "the most important
rules": it is **the rules most likely to be simplified away**. `@SIMULATION_ERROR`
reads like philosophy, `@EVIDENCE_ORDER` like ceremony, `@PLAN_BINDING_ENFORCEMENT`
like bureaucracy. That is exactly why they are pinned.

**Open proposal (2026-09-13, unauthorized — L3, awaiting the user):** add
`@ROOT_OF_TRUTH` and `@INTENTION_INVARIANCE`. The first declares the graph canonical
within its scope, so if it can be weakened the whole precedence order becomes
amendable. The second is why `@LOOP_MEASURE` means anything: without a fixed target,
narrowing the goal decreases every component of the measure at once, and an agent can
score progress while abandoning the request. Both read as droppable prose, which by
the criterion above is the argument for pinning them.

## Procedure

1. **Proposal** — a separate artifact, not a patch against the kernel. Carries: depth,
   the diff in norms, `prev-md5`, rationale, impact set.
2. **NO_DUPLICATE_NORM** — does the proposal create a second authority parallel to an
   existing norm? If it overlaps, amend or replace; never add a parallel.
3. **Constitutional check** — does it weaken the core? If yes, DENY without discussion.
4. **Impact analysis** — which gates, contracts and identities are touched; which
   scenarios break.
5. **Constitutional tests** — `prompt_kernel/tests/test_constitution.py`, run before and
   after. *Without them a SELF_MODIFY closes Unknown.* They do not check that the kernel
   renders — `test_render` does that. They check what makes it a kernel: the core set is
   exactly the declared one (pinned in the test too, so changing the constitution means
   changing a test), each core rule keeps its load-bearing clause, gutting or renaming one
   is caught, core rules still render as named declarations, only three identities may
   mutate, `SELF_MODIFY` and `PROMOTE_STABLE` stay distinct classes, G7 still requires its
   envelope and G6 still requires ALLOW, and the evidence ladder still reaches Exact only
   through smoke or PoC. Each is paired with a mutation that makes the guard fire.
6. **Authorization** — the user for L2 and L3; runtime ACL as the second anchor for L3.
7. **Version stamp** — new sha256 in `baseline.json`, `prev-md5` the previous one,
   `parent-goal-md5` the proposal. No stamp, no change.
8. **Freeze** — the new kernel is live and the previous one stays reachable for
   rollback; when the freeze ends, rollback closes.
9. **Rollback point** — an exact snapshot, not a diff backwards.

Steps 7 and 9 are already mechanical: `python -m prompt_kernel` renders into
`prompt_kernel/dist/<timestamp>_reasoning_prompt.txt` and prints the sha256 **without
installing** (`working_copy=not_updated`); `--install` is the separate promotion step.
Those are two different action classes — `SELF_MODIFY` changes the source,
`PROMOTE_STABLE` moves the render into a runtime surface — and running them as one
motion is how an unreviewed kernel reaches production.

**Working order for L2 and L3:** edit `source.py` → `python -m prompt_kernel` (dist,
no install) → validator, dedup, `pytest prompt_kernel/tests/` → **the diff to the
user's eyes** → `--install` and repin only afterwards.

## Bootstrap

Who authorized this ruling, when the procedure it defines did not yet exist? It
entered as an L3 by **external reset** — applied by the user directly, outside the
procedure, because there was no procedure. Every SELF_MODIFY after it goes through it.

That is not a loophole. Any system of rules has a point of conception that cannot be
derived from the system.

## Rollback point for the ruling itself

| | |
|---|---|
| last commit before the ruling | `0dc9216e9e` |
| installed prompt sha256 | `fe156a41308a5b8195b3897e40a2b01ef2314ded7ab39a5deb9c92c03eb3207b` |
| dist snapshot | `prompt_kernel/dist/2026-09-13_00-07-28_reasoning_prompt.txt` |
| ruling landed in | `629b08f2d7` |

## Parked proposals

Amendments that were argued for and deliberately NOT applied, because the claim
behind them is behavioural and nothing short of a long run settles it. Kept here
so the reasoning is not re-derived from scratch, and so a future run has
something to measure against.

### Choose the oracle at G3, not at G8

| | |
|---|---|
| raised | 2026-09-17 |
| status | **parked, unvalidated** |
| scope | G3 `SMOKE_CONTRACT`, G8 `@ORACLE` |
| decision | leave the kernel as is — it is battle-tested in this shape |

**Proposal.** Require the instrument for each claim to be named in G3, alongside
the smoke contract, rather than selected in G8 when the claim is verified.

**Argument.** `@ORACLE` demands an instrument that *can fail*. That catches the
tautological oracle; it does not catch the mis-aimed one, because an instrument
pointed at the adjacent layer fails perfectly well — it just answers a different
question. And by G8 a hypothesis already exists, so the instrument gets picked
to confirm it. G1 already carries the rule ("choose the instrument by the layer
the problem lives on, not by what is nearest… right numbers end the search"),
but as an attention rule at grounding, not as a binding on the claim.

**Evidence for.** A win32→win64 port of a large Delphi codebase (GR32 blend path
rewritten to AVX2 in an external x64 assembler library) mapped four layers in
advance — bit-exactness against the Pascal reference, dispatch via the priority
registry with the PUREPASCAL fallback live, frame behaviour through cua, and a
per-routine timing table — and all four claims landed. A `vzeroupper` omission
is bit-exact and merely slow; only the visual/timing layer can see it.

**Evidence against.** None measured. The same session that produced the argument
aimed three instruments at the wrong layer *while the gates moved correctly*,
which shows the gap is real but not that this amendment closes it.

**Falsifier.** A day-scale autonomous run on a large codebase, counting
mis-aimed-instrument incidents with and without the binding. Ordinary smokes
cannot settle it: they pin the structure of the kernel, not its effect on
reasoning — the same limit recorded under *Coverage* below. Until such a run
exists this stays parked; do not promote it on argument alone.

## Open problems — long-horizon autonomy

The system is built for runs of a day to a month, and the stated target
(2026-09-17) is operation **with no human in the loop at all**. These are the
gaps that scale-out exposes. None has a proposed amendment yet; they are here so
a long run has something to look for.

### Flawless execution of a wrong plan

`@LOOP_PROGRESS` catches stalling. `@INTENTION_INVARIANCE` catches goal drift.
Neither catches three hundred hours of disciplined, measurable, oracle-backed
work down a branch that was architecturally dead at hour three — every gate
moves correctly, the measure decreases, the ledger fills. `@ONE_STEP_AHEAD` and
the G5 concern loop look in this direction but act at decomposition time, not at
hour 300. Tolerable over a day; not over a month.

### The human-free target removes a backstop the graph relies on

`G0 → WAITING_APPROVAL` and `G4 → ASK` are terminals that assume someone
answers, and `@LOOP_PROGRESS` routes an exhausted loop budget to ASK rather than
letting it turn. With no human those are not terminals, they are stops. Either
they need an autonomous resolution path, or a run must be able to close as
BLOCKED with a recorded residual and be resumed by a later cycle — a different
contract from the one written. Same for the oracle of last resort: today a
human can settle what no instrument settles, and that fallback disappears.

### Correction rate, not step quality

Over 10^4 steps the governing quantity is whether errors are corrected faster
than they are introduced. An agent correct in 99% of steps yields a broken
project, broken invisibly. This is why an oracle on every leaf outranks a better
model: a better model raises the percentage, an oracle changes the sign.
Falsifier: a long run instrumented to count injected vs corrected defects per
100 steps — if the ratio is stable rather than improving as leaves get smaller,
this is wrong.

### A month is not one run

It is hundreds of sessions, crashes, restarts, model swaps. State must live
outside the model, which is what `plans/`, `_progress_log.md`, fossil snapshots,
checkpoints and m\* are for — substrate for resumability, not conveniences. A
fast task solver is not resumable in principle: its state is its context, and
its context dies with the session.

### The deliverable is the trail

At 200 lines a human is the verifier. At a month's scale nobody reads it all, so
verification has to be delegated to the process, and the product of a run is not
the code but **the evidence that makes the code acceptable without redoing the
work** — claim ledger, per-layer oracles, timing tables, reference comparisons.
With no human at the end either, that trail's consumer is the next cycle and a
later audit, which raises rather than lowers the bar on it.

## What this does not fix

- **Politics.** Which human authorizes an L3 is process governance, not protocol.
- **Speed.** L2 and L3 are slower than a bare G4. That is the price.
- **Coverage.** The constitutional tests exist (12 cases, `test_constitution.py`) but
  they pin the *structure* of the constitution, not its effect on reasoning. Whether a
  kernel still reasons as well after an amendment is a behavioural claim over long runs,
  and no instrument here settles it. That gap is the SELF_MODIFY hole the ruling narrows
  rather than closes.
- **History.** The five L2 changes of 2026-09-12 predate the ruling and went through no
  procedure. They are covered retroactively only in the sense that the current kernel
  passes these tests; nothing reconstructs the review they never had.
