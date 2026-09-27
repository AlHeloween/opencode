# Kernel release — 2026-09-27

Depth: L3 (terminal edges, a side-protocol's trigger set, the premise). Authorized by the owner on
2026-09-27 («коммить и делай релиз»). Rollback point: `prompt_kernel/dist/2026-09-17_23-16-37_reasoning_prompt.txt`
(field use — see `baseline.json` `rollback_reason`). Release render: `prompt_kernel/dist/2026-09-27_17-57-42_reasoning_prompt.txt`.

| surface | path | bytes | sha256 |
|---|---|---|---|
| product | `packages/opencode/src/session/prompt/reasoning_prompt.txt` | 46 976 | `33e22a67…4148a78cd` |
| claude | `.claude/reasoning_kernel.md` | 46 954 | `2825a25a…34566b5d36` |
| codex | `~/.codex/AGENTS.md` (installed) | 46 533 | `0d38e391…d4545b359d8` |
| last blessed (baseline) | — | — | `26d3483d…` (2026-09-25) |

**Baseline is NOT repinned by this release.** Owner, 2026-09-25: «Baseline — только руками». Step 7 of the
procedure is the owner's act — against the AMENDED render (see § Amendment, same day):
`baseline.json` → `sha256: ca6ae5433afd195355ff7207c6bc812d89d70d096cb6697dcbee6988901b7628`,
`prev_sha256: 26d3483dfb3866486ab3cf557f1df0dffedfba11043a863808c09bcb0298d05a`. Until then
`test_normal_build_preserves_current_kernel_hash_boundary` is red, and that red is correct.

## Why — one incident, three layers

An agent (space-bunny-alpha, session `…5lDMi1qo`) made 809 tool calls, 100 edits, **0 builds** and asked
the owner to rebuild or re-run 10 times; the owner rebuilt 10 times (measured by the calibrated reader
below — an earlier grep said 12 and ~12, inflated by keywords in the SV blocks). The day before, deepseek-flash
on the same kernel ran 18 builds itself. Three layers, each measured:

1. **A lying instrument created the blocker** — product code, not kernel, fixed in `1a12d99bd6`. Every
   started background job was labelled `execution=FAILED` (`exit: null` read as failure); the agent's one
   self-build (exit 0 in 3.5 min) came back FAILED and it never built again.
2. **Closure was the only place an agent could start on its own.** ADID 15.3 Mode 2
   (`docs/ADID_Framework_15_3.md:212-214`) self-triggers after the primary tasks complete AND in an
   undirected conversation with history. Only the first survived the port: `EVOLUTION_LOOP` observed
   `[G9]` alone. An agent whose every task was blocked could not reach G9, so every move became a
   question. Found by the agent itself; confirmed against 15.3 by the owner.
3. **The priced exits of 2026-09-25 became a template for the exit.** «a missing instrument» sat on the
   G4 edge to the user and primed the route it negated; «hand-over» named no target, and the user is
   always reachable.

The protocol also never said why anyone should follow it: it named what the oracle measures and said
"never reward" once, about affect (owner, 2026-09-27).

## What changed (since the 2026-09-25 baseline)

- `2528eca402` — ASSERTION_STATUS: a `so` joined two true halves with a backwards derivation; now
  adversative. Found by an outside model.
- `0e2d752ce8` — `EVOLUTION_LOOP` observes `[G0, G4, G6, G8, G9]`; `SELF_TRIGGER` defines a stall (every
  open task blocked by anything but a user decision) and needs history for an undirected conversation;
  its medoids serve the same to_state — a proposal, not a question. G4 back to the 09-17 text
  (`ASK requires a user decision`); the 09-24 `HANDOVER_OR_SWITCH` rule removed.
- `0e2d752ce8` — G6 terminal bound to the identity contract: `the plan is complete and this identity's
  gates exclude G7` (PLAN_MODE only; the user is not an identity). The outside falsifier showed the 09-17
  wording and the stall trigger fired on one condition with no precedence.
- this release — the premise declares the reward: *"the oracle measures it against reality, and evidence
  shrinking it is the only reward — accumulated, it is the project's maturity."* Maturity is the SAME
  reward accumulated, not a second one, so "only" holds. "By evidence" keeps it clear of
  `@SIMULATION_ERROR` (shrinking by editing the simulation is treatment) and of "affect … never reward".

**Evicted** to fund it (duplicates, not norms): INFOMARK's "Simulation never equals reality" (restated
verbatim in 1.1), ORACLE_ROLE's `@SIMULATION_ERROR` cross-reference (the rule keeps two consumers in G8),
G9's "a stop whose residual is recorded is legitimate closure" (same norm as "Record the remainder as
residual — finished, not abandoned").

## Procedure (docs/kernel-amendment.md)

1–2. Proposal and NO_DUPLICATE_NORM — the commits above and `_progress_log.md`; the reward line replaces
nothing and the three evictions each removed a restatement. 3. Constitutional check — core unchanged;
4. Impact — premise, G4/G6 edges, one G6 rule, `EVOLUTION_LOOP`, two terms, one G9 rule, three
registries. 5. Constitutional tests — 12/12; full suite 106 passed, one expected red (baseline).
6. Authorization — the owner, 2026-09-27. 7. Version stamp — **pending, owner's act** (above).
8–9. Freeze and rollback — the 09-17 artifact and every intermediate render stay in `dist/`.

## Not verified — read this before trusting the release

- **The behavioural oracle has a baseline, not yet an after-reading.** "The agent no longer hands its own
  build and test to the owner" is Inferred until a session runs on the rebuilt binary. The reader is
  `experiments_history/2026-09-27_reward-denominator/denominator.py` (read-only over the store, calibrated by
  hand). ✓ Baseline, `…5lDMi1qo` · space-bunny, 141 turns: 75.2% of turns under an instrument, 10 asks to the
  owner, **0** self-launched builds, 10 owner rebuilds; deepseek-flash reference the day before: 97.5%, 1 ask,
  18 builds. The 2026-09-24 grounding-first metric turned out mis-specified (it penalises G1's state line) and
  is replaced for the next reading — see that README. Attribution will be confounded — `1a12d99bd6` removed
  the lying FAILED in the same window, so a drop cannot be credited to the kernel alone.
- **Outside falsifier** (`tools/aicall.py`, space-bunny-free — the only Zen model admitted from outside
  OpenCode): found the G6 double route (fixed). The reward line is an **uncovered criterion**: two runs
  failed on the instrument (cut at 20 000 tokens with the reasoning dropped by `--json`; then a 300 s read
  timeout). The three-architecture panel (Nemotron / LongCat / Space Bunny) needs a run from inside OpenCode.
- **Open, owner's call:** G4 «ASK requires a user decision» is broad — an agent can present its own step
  as a user decision; the self-trigger has no carve-out for an explicit user instruction to stop or stay.
- **The running binary carries the old prefix** until a rebuild; promotion into `bin/` is the owner's act.

## The ceiling

product 46 976 / 47 000 — **24 bytes free**. The next addition needs an eviction or the owner's decision
on the levers listed in `docs/kernel-release-2026-09-24.md` § "The ceiling is now the binding constraint".

## Amendment, same day — the reward pays for movement, not for confirmation

A second outside falsifier — bare `claude -p` (sonnet, `--system-prompt` replaced, `--tools ""`, no MCP, run
from an empty directory; route recorded in the `aicall` skill) — returned a complete review of the released
reward line. Each finding below was re-checked against the text before acting on it:

- "evidence **shrinking** it is the only reward" paid nothing for a refutation or a newly found error — the
  most valuable measurements, and the second LOOKS like the error growing. A stated incentive to avoid
  risky measurement.
- "accumulated, it" had three live antecedents (the error, the evidence, the reward).
- "the simulation" named neither of the two simulations the premise introduces.

Now: *"the only reward is both simulations moving toward reality under evidence — a refutation or a found
error pays like a confirmation, and what stays moved is the project's maturity."* Unknown is deliberately
NOT listed as paying: `@INFORMATION_STATUS` calls it "not a destination", and paying for it would invite
farming it; moving a false certainty to Unknown is still movement toward reality.

Funded by one more evicted restatement: `generic_web`'s "a web hit is Hypothetical." (stated in 1.1, in the
1.3 ladder one line above, and in `@INFORMATION_STATUS`).

| surface | bytes | sha256 |
|---|---|---|
| product | 46 998 | `ca6ae543…901b7628` |
| claude | 46 976 | `d81c5124…13c3b605` |
| codex | 46 555 | `d8bf7b67…39fddc19ad` |

Render: `prompt_kernel/dist/2026-09-27_18-20-16_reasoning_prompt.txt`. Tests 106 passed, constitution 12/12,
baseline guard red until the owner repins. **2 bytes free.**

Still open after the second pass: the line does not pay for CLOSING (a finished unit earns nothing beyond
the movement it already made); narrowing the target is refused by `@INTENTION_INVARIANCE`, which the
reviewer had not been shown. Any further precision needs an eviction decision (levers in the 09-24 doc).
