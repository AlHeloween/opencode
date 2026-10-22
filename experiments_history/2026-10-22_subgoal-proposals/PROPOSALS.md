# t142 — proposed subgoals for the plans that do not serve the level-0 goal directly

Measured 2026-10-22 on `Local_Development` (branch of record), two other robots working the same tree on
disjoint paths. Every number below is READ from an artefact this task wrote or from the product's own
instrument — nothing is typed from memory.

**What this file is:** the owner's decision list. The level-0 goal lives in the hand-owned head of
`plans/MASTER_PLAN.md` and that head was NOT touched (sha256 before and after, §7). The plans that serve a
narrower aim need a subgoal, and a subgoal does not exist yet — so it is PROPOSED here, with its aim, its
draft vector, the plans it would hold and why those plans belong together. The owner decides; the head is
written by the owner's hand.

**What this file is not:** a decision. It is a proposal with the rule that produced it named, so the owner
can overturn the rule instead of arguing with 28 rows.

---

## 1. The measurement, before → after

| census (top-level `plans/*.md`, the product's own population — `collectPlans`, `util/plan-status.ts:441`) | BEFORE | AFTER |
|---|---:|---:|
| plans under `plans/` | 51 | 51 |
| resolve to the level-0 goal `f2e94a7cb5d18603e8a4c9d2f7b56e0a` | 7 | **23** |
| carry a NON-ZERO parent that names no goal (a stale plan-to-plan anchor) | 16 | **0** |
| carry 32 zeros (name no goal) | 13 | 28 |
| carry no SV block at all | 15 | **0** |
| render's `\| unlinked plans \| N \|` row | absent from the committed body | **28** |

Two numbers matter more than the first row:

- **16 → 0** — the plans that the gate counted as LINKED while their parent named nothing that exists.
  Each of those sixteen carried a *plan-to-plan* anchor (another plan's label) in the field whose meaning
  is «the goal I serve», so `svm render` printed «link: parent-goal-md5 … (names a master-plan goal)» for
  a parent that names no goal. That claim is now true where it is made, and false where it cannot be.
- **15 → 0** — every plan now carries its own vector, and every one of the 15 that had none was minted
  from that plan's own aim (§7).

## 2. The rule that produced the split (the owner can overturn the rule)

The level-0 goal reads:

> Make the agent's continuity mechanical rather than remembered: every turn opens from a known, verifiable
> state (kernel §1.4 SVM), every mechanism carries the granularity of the scale it serves, and nothing is
> claimed done without an instrument that could have failed. Current focus: the turn loop itself (stall,
> snapshot, automode) before any new surface.

**Rule R.** A plan serves the level-0 goal **directly** when its own `to_state` is an instance of one of
the goal's own clauses — the state a turn opens from, the granularity of a mechanism, the kernel's
contracts, the corpus the agent reads, or the proof that a claim was earned. A plan serves a **narrower
aim** when its `to_state` belongs to a product surface, a provider, a fleet lane or a distribution
artefact — those are not instances of the goal, they are the work the goal's mechanism makes possible.

Rule R is stated so it can be overturned. If the owner reads it differently, the 16 direct links and the
five subgoals move with it, one line per plan.

**What this rule buys.** A goal tree the owner can read: 23 plans hang directly off the level-0 goal; the
other 28 hang off one of five proposed subgoals, each of which is one LINE OF WORK with one aim.

## 3. The five proposed subgoals

Each is a PROPOSAL. Its vector carries `parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a` — a subgoal's
parent IS the level-0 goal, so the tree the owner approves is one level deep under the goal, not a flat
list.

### S1 — Delegation, verification and the organisation protocol

**Aim.** An order becomes a dossier, the dossier becomes a verified result, and no robot is left unwatched
— the fleet works as one organisation whose state the owner can see.

```yaml
Keywords: delegation-cycle 0.30, dossier-gate 0.20, independent-verification 0.20, unwatched-robot 0.15, owner-visible-state 0.15
Semantic dominant: An order becomes a dossier, the dossier becomes a verified result, and no robot is left unwatched — the fleet works as one organisation whose state the owner can see.
md5: 221e9347f99b038b669b74d80886fca1
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
```

**Plans it would hold (8).**

| plan | its slice of the cycle |
|---|---|
| `2026-10-20_robot-personnel-delegator.md` | ORDER — a dossier per robot, an independent verifier named |
| `2026-10-20_hr-delegator-driver.md` | ORDER — the driver that gates every order on a deterministic dossier |
| `2026-10-14_return-channel-binding.md` | HANDOFF — `done`/`escalate` carry a clean next state, the heartbeat is the session's own activity |
| `2026-10-19_codex-robot-event-handoff.md` | HANDOFF — the external robot's completion ends the waiting call |
| `2026-10-21_robot-pending-stop-hook.md` | WATCH — a turn may not end while an ordered robot is unwatched |
| `2026-10-15_dais-peer-trust-reward.md` | VERIFY — trust is the track record of claims that survived independent verification |
| `2026-10-21_corporation-observability-bridge.md` | OBSERVE — one process where every robot server reports its tree bridge |
| `2026-10-21_delegation-tool-tdz.md` | the lane itself — the delegation tools read the recents list before it is filled |

**Why these belong together.** One cycle, and each plan is one stage of it. The project's own measured
prior says the same: t135's overlap table (§6.1) names «the delegator lane» (four plans) and «the org
layer» (four plans) as two views of ONE organisation. The personnel plan says it in its own text: «This
plan is qualification/pilot lane, t105 — the mechanism driver; H2/H3/H4 are executed through t105's common
contract, without a second competing implementation» — the two are already declared to be one mechanism.

### S2 — Distribution: the robot reaches another machine, hermetically and audited

**Aim.** A colleague's unprepared Windows gets a working robot from one offline bundle — nothing leaks
from a parent folder, and everything shipped has a measured egress and a known build provenance.
| `2026-09-30_cua-supply-chain-audit.md` | the egress manifest + build provenance of what is shipped |
```yaml
Keywords: offline-installer 0.30, hermetic-binary 0.25, egress-manifest 0.20, portable-org-home 0.15, tracked-procedure 0.10
Semantic dominant: A colleague's unprepared Windows gets a working robot from one offline bundle — nothing leaks from a parent folder, and everything shipped has a measured egress and a known build provenance.
md5: 2c33f070c3231dc454ef0caaafff392e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
```

**Plans it would hold (5).**

| plan | its slice |
|---|---|
| `2026-09-30_robot-installer.md` | the unified builder + the offline Go/Wails installer |
| `2026-10-17_portable-binary-hermetic.md` | the binary reads only exe-adjacent and data-root sources |
| `2026-10-08_org-portable-home.md` | `ORG_HOME`/`ORG_PORT` as supported settings, bundled fossil outranking PATH |
| `2026-10-30_cua-supply-chain-audit.md` → `2026-09-30_cua-supply-chain-audit.md` | the egress manifest + build provenance of what is shipped |
| `2026-10-21_portable-delegation-kit.md` | the delegation procedure as a TRACKED, path-discovering kit |

**Why these belong together.** The installer is the CONSUMER of the other four, and they say so: the
supply-chain audit's own line reads «Consumer: `plans/2026-09-30_robot-installer.md` ships only components
with an approved egress manifest»; the hermetic binary and the portable org home are the installer's own
components (the org home is «Requested by: Installer session … box B1f (component `org`)»); the portable
kit is the delegation procedure that has to travel with the bundle. One artefact, four guarantees.

### S3 — Surfaces the agent sees and drives

**Aim.** The TUI, the browser and the desktop driver show the same live state and obey the same surface
standards, and the agent can act on a window without taking the owner's cursor.

```yaml
Keywords: tui-surface-standards 0.30, web-tui-parity 0.20, live-session-state 0.20, observable-window 0.15, input-without-focus-steal 0.15
Semantic dominant: The TUI, the browser and the desktop driver show the same live state and obey the same surface standards, and the agent can act on a window without taking the owner's cursor.
md5: 423648bc309f9b843f29291adf271959
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
```

**Plans it would hold (6).**

| plan | its slice |
|---|---|
| `2026-10-15_tui-active-sessions-panel.md` | the sidebar's live list of running sessions |
| `2026-10-15_web-tui-parity.md` | the browser form reaching the same parity, surface by surface |
| `2026-10-21_tui-standards-fixes.md` | the dialogs bound to the surface-standards clauses, each with a capture |
| `2026-09-22_reasoning-stream-render-stability.md` | the reasoning window as an append-only surface with an atomic commit |
| `2026-09-29_cua-windows-debug-input.md` | the agent observing and driving a Windows window without stealing the cursor |
| `2026-10-08_mcps-connector-manager.md` | `/mcps` as the one place to attach a connector |

**Why these belong together.** One surface family: what the owner and the agent SEE. The sidebar's
session block and the browser's parity are the same block on two surfaces; the standards fixes and the
reasoning-window stability are the same render contract; the CUA driver is the same question one level
down (acting, not only seeing); `/mcps` is the same question for connectors.

### S4 — What crosses the model boundary: cost, cache, transport and the text that comes back

**Aim.** Every request costs what it says, the static half is cached where it belongs, the transport is
qualified against the provider's own caps, and the text that returns is the text the agent needs.

```yaml
Keywords: request-cost 0.30, cache-placement 0.25, transport-qualification 0.20, reasoning-preservation 0.15, returned-text 0.10
Semantic dominant: Every request costs what it says, the static half is cached where it belongs, the transport is qualified against the provider's own caps, and the text that returns is the text the agent needs.
md5: 51b888a0804adb07ef476bdf40de0da1
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
```

**Plans it would hold (6).**

| plan | its slice |
|---|---|
| `2026-10-04_files-api-and-tariff.md` | the money counted at the measured tariff; files addressed by a link |
| `2026-09-12_anthropic-cache-breakpoints.md` | the static half behind real breakpoints; the thinking variant on the wire |
| `2026-09-29_h2-session-pool-and-connection-badge.md` | the transport: a pool sized from the provider's advertised caps |
| `2026-10-16_reasoning-lossless-replay.md` | reasoning and metadata survive to the next request |
| `2026-10-16_message-cleaner.md` | the text that comes back is the text the next request can use |
| `2026-10-16_haiku-omp-controlled-latency.md` | the measured comparison of the same request across two harnesses |

**Why these belong together.** One boundary. The request that leaves carries the cost, the cache
placement and the transport; the response that returns carries the reasoning and the text. The latency
study is the same boundary measured from the other side (it compares the ACTUAL requests of two
harnesses and refuses to transfer a local PASS into an end-to-end claim).

### S5 — Which model, and whose credentials

**Aim.** The model a layer picks is checked against the allowlist, and a failed authorisation says why
instead of `{}`.

```yaml
Keywords: model-allowlist 0.35, credential-errors 0.30, layer-model-constraint 0.20, port-conflict-fallback 0.15
Semantic dominant: The model a layer picks is checked against the allowlist, and a failed authorisation says why instead of an empty error.
md5: a9cdbdeef0bce63c1eea1385e0c8ab64
prev-md5: 00000000000000000000000000000000
parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a
```

**Plans it would hold (2).**

| plan | its slice |
|---|---|
| `2026-10-18_global-recents-constraint.md` | every worktree/session/chain layer is checked against the global recents allowlist before a model is used |
| `2026-10-18_codex-oauth-empty-error.md` | the OAuth login that answers `{}` instead of the real cause |

**Why these belong together.** Both are the seam where a LAYER picks a model or a credential and the
failure is SILENT — a stale pick that nobody checks, and an error object that carries no cause. The
second plan's own S1 says it: «the real error travels through `authorize`/`callback` (log + `BadRequest`
with `message`)».

> **A note on S5's size.** Two plans make the thinnest subgoal in the list. The owner may fold it into S4
> (both are «what the provider gets») or keep it separate. It is listed separately because the two plans
> have nothing in common except the SEAM they sit on, and a subgoal that says «the seam» is honest about
> what it is.

## 4. The 28 plans that still wait on a subgoal — every one named

Each of these carries `parent-goal-md5: 00000000000000000000000000000000` and a marker line naming the
subgoal it waits for (`<!-- subgoal: s4-model-boundary … -->`), so the plan file itself states what it is
waiting for — the reading is in the file, not only in this document.

| # | plan | waits for | the parent it carried BEFORE this task |
|---:|---|---|---|
| 1 | `2026-09-12_anthropic-cache-breakpoints.md` | S4 | none — no SV block at all (vector minted) |
| 2 | `2026-09-22_reasoning-stream-render-stability.md` | S3 | none — no SV block at all (vector minted) |
| 3 | `2026-09-29_cua-windows-debug-input.md` | S3 | 32 zeros |
| 4 | `2026-09-29_h2-session-pool-and-connection-badge.md` | S4 | none — no SV block at all (vector minted) |
| 5 | `2026-09-30_cua-supply-chain-audit.md` | S2 | 32 zeros |
| 6 | `2026-09-30_robot-installer.md` | S2 | 32 zeros |
| 7 | `2026-10-04_files-api-and-tariff.md` | S4 | none — no SV block at all (vector minted) |
| 8 | `2026-10-08_mcps-connector-manager.md` | S3 | none — no SV block at all (vector minted) |
| 9 | `2026-10-08_org-portable-home.md` | S2 | none — no SV block at all (vector minted) |
| 10 | `2026-10-14_return-channel-binding.md` | S1 | 32 zeros |
| 11 | `2026-10-15_dais-peer-trust-reward.md` | S1 | 32 zeros |
| 12 | `2026-10-15_tui-active-sessions-panel.md` | S3 | `e31df24e5415d6a594172176f48af8e0` — a plan-to-plan anchor, no goal |
| 13 | `2026-10-15_web-tui-parity.md` | S3 | 32 zeros |
| 14 | `2026-10-16_haiku-omp-controlled-latency.md` | S4 | 32 zeros |
| 15 | `2026-10-16_message-cleaner.md` | S4 | 32 zeros |
| 16 | `2026-10-16_reasoning-lossless-replay.md` | S4 | `81e70d3af5c64b8292d15e6f370a49bc` — a plan-to-plan anchor, no goal |
| 17 | `2026-10-17_portable-binary-hermetic.md` | S2 | 32 zeros |
| 18 | `2026-10-18_codex-oauth-empty-error.md` | S5 | none — no SV block at all (vector minted) |
| 19 | `2026-10-18_global-recents-constraint.md` | S5 | `6d0b84e2f9a317c5b8e0d4a6c2f91b73` — the plan's OWN label, no goal |
| 20 | `2026-10-19_codex-robot-event-handoff.md` | S1 | `f81c69a257304de89b06173ac54e2f90` — a plan-to-plan anchor, no goal |
| 21 | `2026-10-20_hr-delegator-driver.md` | S1 | `e27b5c90a4d13f68b0c9e2a71d4f8b53` — a plan-to-plan anchor, no goal |
| 22 | `2026-10-20_robot-personnel-delegator.md` | S1 | 32 zeros |
| 23 | `2026-10-21_corporation-observability-bridge.md` | S1 | `6b1e8d4a2f9c37e05b6e1a8d4f2c9e73` — a plan-to-plan anchor, no goal |
| 24 | `2026-10-21_delegation-tool-tdz.md` | S1 | `c7218c11076948a099404504393f1f50` — a plan-to-plan anchor, no goal |
| 25 | `2026-10-21_portable-delegation-kit.md` | S2 | `2b6e9d4a7f1c38e05b2e6a9d4f7c1b58` — a plan-to-plan anchor, no goal |
| 26 | `2026-10-21_robot-pending-stop-hook.md` | S1 | `4d7b2e9f1a6c38e05d4b7a2e9c1f6d38` — a plan-to-plan anchor, no goal |
| 27 | `2026-10-21_tui-standards-fixes.md` | S3 | `9f2c5e8a1d7b36e04c9f2a5e8d1b7c43` — a plan-to-plan anchor, no goal |
| 28 | `2026-10-22_write-writeback.md` | S4 (proposed) | 32 zeros — **NOT TOUCHED**, see §6 |

**Nothing else blocks any of them.** Each of the 27 edited plans waits on exactly one thing: the owner's
decision on its subgoal. None of them waits on a robot, a credential or a measurement.

## 5. Plans whose remaining work is bookkeeping or a decision — named, not linked-to-look-good

The brief says a plan whose aim is already done or superseded is not linked to make the count look good.
These three are named here with their evidence. **All three ARE linked to the level-0 goal** (their aim is
a genuine instance of it) — the point of naming them is that their remaining box is not a robot's leaf, so
nobody dispatches a robot at them.

| plan | what is left | the evidence |
|---|---|---|
| `2026-10-15_kernel-undefined-contract-audit.md` | one box (A2): archive + docs + commit | the AIM is delivered — t135 addendum 2 measured the receipt: `experiments_history/2026-10-15_kernel-undefined-audit/parent-review.md` (9/9 snapshot SHA, 8 confirmed rows = 4 lexemes, 7 rejected candidates, 1 Unknown). What remains is the close-out half, named in the box itself. |
| `2026-10-21_delegation-tool-tdz.md` | one box (T6), titled «CLOSURE» | the DEFECT is fixed (the tools read the recents list before it is filled); T6 is the closure step — move the plan with its evidence, commit, log row. |
| `2026-10-08_org-portable-home.md` | one box (S9), titled «GATED» | S9 is «kernel `--install` (production, claude, codex, cursor) + receiver refreshes — GATED on Claude's review verdict». That is a REVIEW VERDICT, not a robot's leaf. The plan's own note says the kernel part stops before `--install`. |

**Two pairs that are duplicates, named so the owner can merge them (not linked differently):**

- `2026-10-01_tool-description-contracts.md` (older) and `2026-10-19_tool-description-contracts.md` (newer)
  carry the SAME contract work. t135 closed the older one's C3/C4/C5 as superseded by the newer one's
  T10/T11 (receipts: `T10-write 805732ed`, `T10-task 8334d3f9`) — and then REOPENED the older one's C2
  (the grep-tool residual, class (a) over `adedb84375` contradicts the box's own residual). So the older
  plan is NOT superseded: it carries a live residual. Both are already linked to the goal.
- `2026-10-20_hr-delegator-driver.md` (t105, the mechanism) and `2026-10-20_robot-personnel-delegator.md`
  (the pilot lane) declare themselves ONE mechanism — the pilot's H2–H4 run «through t105's common
  contract, without a second competing implementation». Both are in S1; the owner may merge them.

## 6. The two plans this task did NOT touch (foreign lanes)

| plan | why not | the one-line change its lane can apply |
|---|---|---|
| `2026-10-22_write-writeback.md` | UNTRACKED and written 5 minutes before this session started: it is the live lane of the t140 robot (its `src/tool/write.ts` and `test/tool/write-writeback-t140.test.ts` are also uncommitted). Touching it would write into another robot's open file. | its aim is a DIRECT instance of the level-0 goal («the file is read back after every write … a file that is not what the tool wrote is NAMED instead of claimed as a success» = «nothing is claimed done without an instrument that could have failed»), so its `parent-goal-md5` should become `f2e94a7cb5d18603e8a4c9d2f7b56e0a` — one line, at its `parent-goal-md5:` line 11. |
| `2026-10-19_codex-robot-event-handoff.md` — the file carried 8 uncommitted lines from another robot's finished pass (R3, 2026-10-22 05:24–05:44 local, mtime 5 h before this task). Following the precedent t135 set (addendum 2: a dirty plan file with no live writer is committed EXACTLY as authored, with the provenance named in the commit message), those 8 lines ARE committed here, unchanged, and the linkage change rides on top of them. | — | — |

## 7. What changed in the plan files, and what did not

**Changed (43 plan files).**

- **16 plans re-pointed to the level-0 goal**: `parent-goal-md5: f2e94a7cb5d18603e8a4c9d2f7b56e0a`.
  Their names and the clause of the goal each serves are in §8.
- **15 vectors minted** for the plans that had none — Keywords (weights summing to 1.0, descending), a
  one-line `Semantic dominant`, a fresh 32-hex `md5`, `prev-md5` 32 zeros, and the parent. Each was
  computed from THAT plan's own aim, not from its title.
- **2 malformed labels repaired**: `2026-10-16_self-edit-directive.md` carried
  `md5: 7f3a9c1e4b5d6a708192a3b4c5d6e7f` — **31** hex characters, not 32 — and
  `2026-10-21_delegator-memory-repair.md` carried `md5: 9e2b47c1a8d350f6c4b9e1a7d205b83` — also 31. A
  31-hex label is invisible to `planHeaderLabel` (`memory/spine.ts:190`, which requires 32), so both plans
  were missing from the plan map and from the coupling watcher. New labels: `51ebec8743f05391e69584a8b4cdeca2`
  and `19d43ab86d651e97f28b5016e28c0dcc`. The old values are recorded here because nothing else names them.
- **10 stale plan-to-plan anchors replaced by 32 zeros** (the old values are in §4, row by row) — the
  field means «the goal I serve», and those values named a sibling plan, not a goal.
- **2 inline `- sv: { … }` forms normalised** into the canonical `@SV_FORMAT` block
  (`2026-10-08_mcps-connector-manager.md`, `2026-10-08_org-portable-home.md`): the keywords and the
  dominant are carried over verbatim, and the block gains the md5 chain the canonical form requires. One
  source, not two.
- **27 marker lines** `<!-- subgoal: sN-… — proposed subgoal awaiting the owner's decision; see
  experiments_history/2026-10-22_subgoal-proposals/PROPOSALS.md §SN -->`.

**NOT changed: the head of `plans/MASTER_PLAN.md`.**

| | sha256 | bytes |
|---|---|---:|
| BEFORE any edit of this task | `f0cef99e5f85d7830fae6f8375045b697708f2fda68aa430fa74ee3573ea956c` | 14 195 |
| AFTER the plan edits, after both renders | `f0cef99e5f85d7830fae6f8375045b697708f2fda68aa430fa74ee3573ea956c` | 14 195 |

The head is every byte up to and including the `RENDER_MARKER` line — the goal, the rules and the checks
(`util/plan-status.ts:584`). The body below the marker is generated and WAS re-rendered (§9).

## 8. The 16 plans linked directly to the level-0 goal, and the clause each serves

| plan | the clause of the level-0 goal its aim instantiates |
|---|---|
| `2026-09-19_database-truth.md` | «every turn opens from a known, verifiable state» — every table has a named writer, every dead surface is removed, every counter is checked against the live DB |
| `2026-09-21_mstar-order-and-summary-restore.md` | the memory block and the summary return to the owner's order — the turn's state, not a dump of patches |
| `2026-09-24_to-be-confirmed-shelf-triage.md` | the plan state surface: every shelved plan reaches a proven terminal, and the surface can see the shelf |
| `2026-09-28_kernel-candidate-incorporation.md` | the kernel is the carrier of the goal's own rules; candidates arrive through L2 cycles, never by replacement |
| `2026-09-29_codegraph-impact-decoupling.md` | «every mechanism carries the granularity of the scale it serves» — the graph's sync leaves the turn's critical path |
| `2026-10-10_plan-hygiene-in-build-mode.md` | every ordinary turn repairs `plans/` itself — the state stays true without a human |
| `2026-10-11_memory-orphan-parts.md` | the memory index stops serving deleted sessions — what a search returns is what exists |
| `2026-10-12_specs-inventory-truth.md` | «nothing is claimed done without an instrument» — inventory that rots is recomputed by a command |
| `2026-10-15_kernel-undefined-contract-audit.md` | every undefined norm in the kernel is bound to a canonical source (see §5 for what is left) |
| `2026-10-16_self-edit-directive.md` | the agent repairs its own working representation — the window opens from a known state |
| `2026-10-16_zoekt-scip-fossil-sv.md` | the corpus the agent reads is local, version-bound and provenance-carrying |
| `2026-10-18_kernel-method-preamble.md` | the kernel states its method and the no-human-oracle line |
| `2026-10-20_kernel-line-audit.md` | the kernel is audited line by line; the owner approves each cut |
| `2026-10-21_delegator-memory-repair.md` | every link of the continuity path that is still a RULE becomes a MECHANISM, and every memory pointer becomes checkable |
| `2026-10-21_fold-hooks-desktop-fork.md` | every desktop window rebuild reopens on the predecessor's owner rows and full SV blocks |
| `2026-10-22_legislator-reincarnation-method.md` | the agent's identity IS its ordered SV chain, and the method to rebuild it is tracked and oracle-checked |

The seven plans that were already linked before this task (t135 addendum 3) are untouched:
`2026-10-01_tool-description-contracts.md`, `2026-10-07_supersede-between-steps-loses-reply.md`,
`2026-10-13_recall-read-address-space.md`, `2026-10-14_kernel-stop-claim-release.md`,
`2026-10-16_model-chain-failover.md`, `2026-10-19_edit-description-contract.md`,
`2026-10-19_tool-description-contracts.md`.

## 9. What the instruments said, and what one of them could not say

- `svm render` (the product's own `applyRender`, run from the current source) → `unlinked: 28`, 51 plans,
  `gapsBefore: []`; the body now carries `| unlinked plans | 28 |` and a `link:` line for every plan.
- `planstatus` prints the same set as `Unlinked: 28 plan(s) name no master-plan goal (…)`.
- **The live runtime in this session could NOT print it, and that is a measured fact, not a guess.** The
  `opencode` process serving this session (PID 1400) started 2026-10-21 21:18 UTC; the commit that added
  the linkage gate (`f1ddc19ef1`, t135 addendum 3) is 2026-10-21 22:22 UTC. The running build therefore
  has no `unlinked` counter: its `svm render` result object had no `unlinked` key and the body it wrote
  contained ZERO `link:` lines. The render used for the committed body was therefore run from the CURRENT
  source through the product's own `applyRender` (`src/session/svm.ts:401`, the same function the tool
  calls at `src/tool/svm.ts:78`) — one implementation, one write path, no copy of the renderer.
  **A rebuilt binary prints the count; this session's TUI does not.** That is the residual of this task.

## 10. How to apply the decision — one mechanical step per plan

For each subgoal the owner approves:

1. write the subgoal's vector into the hand-owned head of `plans/MASTER_PLAN.md`, under the level-0 goal
   (the md5 is in §3 — it is already minted, so the plan's parent can be set to it verbatim);
2. in each member plan, set `parent-goal-md5:` to that md5 and delete the `<!-- subgoal: … -->` marker;
3. `svm render` — the unlinked count drops by the size of that group, and the render's `link:` line for
   each member now names a goal that exists.

Step 2 is one line per plan; the vectors are already in the files, so nothing has to be invented later.
