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
procedure is the owner's act: `baseline.json` → `sha256: 33e22a677fa6195c1d450fe770016dbfb29e94cf078bd8fa928fe2f4148a78cd`,
`prev_sha256: 26d3483dfb3866486ab3cf557f1df0dffedfba11043a863808c09bcb0298d05a`. Until then
`test_normal_build_preserves_current_kernel_hash_boundary` is red, and that red is correct.

## Why — one incident, three layers

An agent (space-bunny-alpha, session `…5lDMi1qo`) made 809 tool calls, 100 edits, **0 builds** and asked
the owner to rebuild and run tests 12 times; the owner rebuilt ~12 times. The day before, deepseek-flash
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

- **No behavioural oracle has run.** "The agent no longer hands its own build and test to the owner" is
  Inferred. Falsifier, per session over the store: asks-to-owner to rebuild/run tests vs self-launched
  builds. Baseline: `…5lDMi1qo` 12 asks / 0 builds. Attribution will be confounded — `1a12d99bd6` removed
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
