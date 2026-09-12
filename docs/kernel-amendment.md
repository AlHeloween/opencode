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
  expected_outputs: ["pytest: 88 passed", "working_copy=not_updated before review", "installed=<sha256> matches prompt_kernel/baseline.json"]
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
5. **Constitutional tests** — scenarios the kernel must pass before and after.
   *Without them a SELF_MODIFY closes Unknown.*
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

## What this does not fix

- **Politics.** Which human authorizes an L3 is process governance, not protocol.
- **Speed.** L2 and L3 are slower than a bare G4. That is the price.
- **The tests.** Step 5 names constitutional tests that **do not exist yet**. Until
  they are written, every SELF_MODIFY closes Unknown by this ruling's own clause —
  including the five L2 changes landed on 2026-09-12, which predate the ruling and
  went through no procedure at all. Writing them is the first work under it.
