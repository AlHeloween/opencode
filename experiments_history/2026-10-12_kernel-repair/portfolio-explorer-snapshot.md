<!--
intention: полный текущий портфель root-планов заново обоснован после kernel repair — inventory изменился (sv-chain ушёл в completed), каждый план сверен с фиксированной стратегией мастера и собственными доказательствами галок; kernel repair после R2 проверен на реальные hash/архив/пины, его ADID-доставка НЕ закрыта
-->
```yaml
Keywords: plan-strategy 0.30, completion-evidence 0.28, kernel-repair-verification 0.22, explorer-audit 0.20
Semantic dominant: Портфель заново проверяется по стратегии мастера и свежим доказательствам; незакрытый ADID-остаток kernel repair назван остатком, а не доставкой.
md5: 4c1e77a9b0d64253ef8a1902334b6c7d
prev-md5: 9f13c2a7d5b84e08a6c1f3d927e4b5a0
parent-goal-md5: d86170bc94f642da8b2f03ae5179cd68
```

# Portfolio — independent snapshot review (post kernel repair)

**Role:** EXPLORER_AGENT, read-only. No plan/source edited, no commit, no move, no release, no install.
**Date:** 2026-10-12. **Branch:** `Local_Development`, HEAD `22a452a938` (top: `22a452a938`, `9695d18b9e`, `fb4a504c1b`, `297e712188`, `94a94acacf`).
**Method:** read every root plan file in full (not the MASTER render), spot-checked load-bearing claims against code through the **CodeGraph MCP** (`codegraph_explore`, bound and answered) and raw read/grep; recomputed inventory by `git`/`glob`; recomputed SHA-256 of every plan and of the kernel pins.

**Scope of this refresh vs the previous explorer:** the previous report is a *handle only* — the inventory changed and its result is not inherited. Re-derived below.

## 0. Tool state (named, not hidden)

- **CodeGraph MCP — AVAILABLE and USED.** `.codegraph/` exists; `codegraph_explore` returned verbatim source + blast radius for `validate_kernel`, `modeToMcpCall`, `mcpTouchQueryThenSqlitePack`, `extractPathsFromText`, `masterPlanCoverage` (receipts in §4). It is not a source-comparison oracle; source verification is by SHA-256 readback (§4).
- **`planstatus` product tool — NOT run** (not in a read-only explorer's declared scope). Its counters are re-derived arithmetically from the plan files; the derived numbers agree with the render (§1).
- The MASTER render is **testimony**: it is generated from the same files, so a render↔source disagreement is named, never smoothed.

## 1. Inventory — count and full list

**Active root `plans/`: 20 plan files** (plus `MASTER_PLAN.md` and `README.md` — NON_PLAN, excluded). The MASTER render's own footer agrees: *«This body names all 20 plan(s) under `plans/`»*. A plan that left: **`2026-10-11_sv-chain-and-scope.md` → `plans_completed/`** at commit `297e712188` («S1-S5 earned, oracles stamped») — this is why the prior snapshot's 21 is now 20.

1. `2026-09-12_anthropic-cache-breakpoints.md`
2. `2026-09-19_database-truth.md`
3. `2026-09-21_mstar-order-and-summary-restore.md`
4. `2026-09-22_reasoning-stream-render-stability.md`
5. `2026-09-24_to-be-confirmed-shelf-triage.md`
6. `2026-09-28_kernel-candidate-incorporation.md`
7. `2026-09-29_codegraph-impact-decoupling.md`
8. `2026-09-29_cua-windows-debug-input.md`
9. `2026-09-29_h2-session-pool-and-connection-badge.md`
10. `2026-09-30_cua-supply-chain-audit.md`
11. `2026-09-30_robot-installer.md`
12. `2026-10-01_tool-description-contracts.md`
13. `2026-10-04_files-api-and-tariff.md`
14. `2026-10-07_supersede-between-steps-loses-reply.md`
15. `2026-10-08_mcps-connector-manager.md`
16. `2026-10-08_org-portable-home.md`
17. `2026-10-10_plan-hygiene-in-build-mode.md`
18. `2026-10-11_memory-orphan-parts.md`
19. `2026-10-12_kernel-contract-repair-and-adid-release.md`
20. `2026-10-12_specs-inventory-truth.md`

**Unaccounted: none** — every root plan file is named in the MASTER render AND read in full here. **Falsifier #1 (a missed root plan) did not fire.**

### The 18-vs-20 counter, resolved

MASTER prints `plans active 18` but names 20. This is **not** an inconsistency: `active` counts plans that carry **at least one open checklist box**; the two checklist-less plans are `anthropic-cache-breakpoints.md` (tasks are `### T1…` headers, no `- [ ]`) and `database-truth.md` (tasks are bold `**T1 —**` items). Counting the per-plan open boxes yields **99 plans-open boxes across exactly 18 plans** — matching the render's `open boxes 99` and `plans active 18`. Status: **CONFIRMED by arithmetic over the files** (was `Unknown` in the prior snapshot).

## 2. Master goal — pin

- **File:** `plans/MASTER_PLAN.md`, hand-owned head, section «Goal — level 0».
- **SHA-256:** `eaa67e8878ec2ac6c4e35093b53845b4b9b4dd25c7c43e2a629731a6a93c35e1`.
- **Goal vector (the one vector this file owns):** `{ agent-continuity 0.35, mechanical-state 0.25, proof-not-claim 0.25, turn-loop-first 0.15 }`.
- **Goal vector md5: absent** — by the file's own rule the goal vector is hand-owned and read from no other source, so it is not `md5`-addressable.
- **Anchor used by this brief:** `parent-goal-md5: d86170bc94f642da8b2f03ae5179cd68` = the `md5` of `2026-10-12_kernel-contract-repair-and-adid-release.md` (its own header vector), which itself declares `parent-goal-md5: 0000…`. The link into the MASTER file is lexical (by intention), not by `md5`-chain — **named, not an error**.

**Requirement restated:** «механическая непрерывность + доказательство падающим инструментом».

## 3. Portfolio — per plan

Legend — contribution: **CORE** (directly the goal invariant) / **PARTIAL** (supports it through an adjacent layer) / **UNALIGNED** (no source-declared link to the master goal; live and possibly sound, but the link is not evidenced). Box counts read from each file.

### CORE

**19. `2026-10-12_kernel-contract-repair-and-adid-release.md`** — *ACTIVE, in-flight; NOT closed by this audit.*
- **Strategy evidence:** section «Стратегия мастера» cites `MASTER_PLAN.md:24`.
- **Completion:** 9 boxes; `[x]` S0, R1a, R1b, R1c, R1d, R1e, R2; `[ ]` A1, A2 (5 open).
- **Fresh verification by me (§4):** R2 source commit `9695d18b9e` matches git; all 4 receiver hashes reproduce byte-for-byte from the live files against `handoff-manifest.json`; the archive `experiments_history/2026-10-12_kernel-repair/` holds 23 checks × (state.json + stdout_text.log), no tail-only; kernel `source_pins` in the manifest match the recomputed SHA-256. **No unconfirmed closed delivery: A1/A2 are open.**
- **Gap:** A1 (ADID release/install) and A2 (independent readback) unexecuted — delivery is NOT confirmed. `live child-order acceptance` explicitly deferred to A1/A2.

**17. `2026-10-10_plan-hygiene-in-build-mode.md`** — ACTIVE. CORE (clean-state / continuity).
- **Strategy:** grounding G1–G6 via codegraph nodes (`plan-status.ts:733/757-759`, `agi-mode.tsx:283/431`).
- **Completion:** 3 boxes; `[x]` M1 (commit `9d4174ee41`, `plan-status.test.ts` 23→25→mutation 24/1→25); `[ ]` M2, SW.
- **Gap:** SW (the accumulated-plans sweep) is the portfolio's largest open debt; M2 has no oracle yet.

**4. `2026-09-21_mstar-order-and-summary-restore.md`** — ACTIVE (Russian header «Статус»). CORE.
- **Completion:** 24 boxes; ~18 `[x]` with commit+run-id; 6 `[ ]` re-checked 2026-10-09 (t27) — `mStarRow`, «план↔SVM↔носитель» (form superseded 2026-10-09: `parsePlanMap` removed; reword before working), side-summary invalidation, memory snapshot at fold, revert acceptance (2/3), §8 recursive scan.
- **Stale gap (HARNESS/replication):** intermittent red `revert-compact.test.ts:658` (`a2` vs `a3`, 3/5 isolated runs; reds `…033332Z_5233b186`, `…033441Z_fff3aa6f`, `…042259Z_a57c7d11`). Needs a replication criterion before the §9 rehearsal is trusted.

### PARTIAL / CORE-adjacent

**6. `2026-09-28_kernel-candidate-incorporation.md`** — ACTIVE. CORE (touches `prompt_kernel/source.py`).
- **Completion:** 59 boxes; 12 open. F1 done; F2/F4 `[~]` owner's call (compression ceiling / coverage); F8 open.
- **Fresh gap:** `kernel-identity-manifest.test.ts` **RED** — live tool set holds `samply`, `identity_tools.json` does not (origin `d582038233`; recipe in F8). F5 install box open. Genuine, not stale (box stays `[ ]`).

**7. `2026-09-29_codegraph-impact-decoupling.md`** — ACTIVE. PARTIAL→CORE.
- **Completion:** 6 boxes; `[x]` C1, C4, C5; `[x]✗` C3 (REFUTED by measurement — a time window cannot select files; indexer domain is code-only) — a result, not debt; `[ ]` C2 (sync off critical path; its own freshness acceptance «still FRESH a few seconds later» unmeasured).

**12. `2026-10-01_tool-description-contracts.md`** — ACTIVE (`state: ACTIVE`). PARTIAL→CORE.
- **Completion:** 9 boxes; `[x]` C0, C1, C1b, C6; `[ ]` C2 (holds exactly one residual: `grep` on an invalid regex answers «No matches» instead of an error, reproduced 2026-10-09), C3, C4, C5, C7.

**20. `2026-10-12_specs-inventory-truth.md`** — ACTIVE. CORE-ish (proof-not-claim).
- **Completion:** 4 boxes; `[x]` S1, S3, S4; `⚠` S1 residual named; `[ ]` S2 (renderer). S3 guard caught `effect/migration.md:259` (RED `20261012T032839Z_bd279f40`).

**3. `2026-09-19_database-truth.md`** — no `Status:` in head → render UNKNOWN; tasks are bold items (no boxes).
- **Completion:** T1–T4 substantively open; Done section fixes `currentTurn` (commit `55415e7ed1`). Re-measured by the plan 2026-10-12: `session_entry` still 0 rows, only writer is the fixture `test/session/turn.test.ts:81`.

**14. `2026-10-07_supersede-between-steps-loses-reply.md`** — OPEN. CORE by substance (lost turn-loop reply).
- **Completion:** 3 boxes, all `[ ]`. Cause still Inferred; no deterministic reproducer yet.

**8. `2026-09-29_cua-windows-debug-input.md`** — ACTIVE (status mid-body). PARTIAL.
- **Completion:** 29 boxes, 16 open. B2/S1/T1/T2/T3/T4/T8 closed with run ids; many open; VMware tier (O2/T5/T6) POSTPONED by owner.

**9. `2026-09-29_h2-session-pool-and-connection-badge.md`** — ACTIVE. PARTIAL.
- **Completion:** 8 boxes; `[x]` T1, T2, T3, T4b, T4c, T5; `[~]` T4 (glyph text-oracle green, visual residual open — owner's screen); `[ ]` TASK-6.

**18. `2026-10-11_memory-orphan-parts.md`** — ACTIVE. PARTIAL.
- **Completion:** 4 boxes, all `[ ]`. Baseline `search.test.ts` 6/0 `20261011T160558Z_f3cd4bd2`. Destructive purge of deleted-session rows needs the owner.

**11. `2026-09-30_robot-installer.md`** — DRAFT. PARTIAL.
- **Completion:** 33 boxes, 19 open. Q1–Q5, B2, C1 (preselected model) closed with runs; Q2b/Q6/C1-final/P1/B2-final/B3/V1–V3/U1/B5–B7 open. Pristine-VM acceptance host OPEN.

**5. `2026-09-24_to-be-confirmed-shelf-triage.md`** — ACTIVE. PARTIAL.
- **Completion:** 4 boxes; `[x]` T1; `[ ]` T2 (**BLOCKED on instrument**: `cmd_runner screenshot` clips the window edge, HF out of credits), T3, T4.

**13. `2026-10-04_files-api-and-tariff.md`** — ACTIVE. PARTIAL (weak link: money/bytes, not continuity).
- **Completion:** 5 boxes; `[x]` T1, T2, T5; `[ ]` T3, T4. **Nearest «checked-but-not-live» case:** T1 `[x]` but the plan states the running binary is older («в работе старый бинарник»), so the tariff effect is not confirmed live. Named by the plan itself, not hidden. Next minimal falsifier: restart the binary → drift alert silent / ratio 2.000.

**10. `2026-09-30_cua-supply-chain-audit.md`** — ACTIVE. PARTIAL (security/provenance, not continuity).
- **Completion:** 10 boxes; `[x]` A1–A4, SA, SB, SC, SD; `[ ]` SE (reliability classes), SF (Universal Search). Retains a recorded FORECAST ERROR in A3 (env var is a banner switch, not a network switch). Critical: `check_for_update` reaches GitHub despite the opt-out.

**16. `2026-10-08_org-portable-home.md`** — no `Status:` in head → UNKNOWN; carries `- sv:`. PARTIAL.
- **Completion:** 9 boxes; `[x]` S1–S8 (smoke 12/12 `20261008T053856Z_13279496`; pytest baseline 145 → post 3 fail/142 = exactly the install-gated receiver guards); `[ ]` S9 — **GATED** on the kernel diff review (a gate, not a forgotten tick).

**15. `2026-10-08_mcps-connector-manager.md`** — no `Status:` in head → UNKNOWN. **UNALIGNED.**
- **Completion:** 8 boxes; `[x]` S1, S2, S4; `[~]` S6; `[ ]` S3, S5, S7, S8. TUI connector surface — **no source-declared link to the master goal found**; not invented here.

### UNALIGNED

**1. `2026-09-12_anthropic-cache-breakpoints.md`** — `state: DRAFT`. **UNALIGNED.**
- **Completion:** tasks `### T1…T5`, no checkboxes → 0 boxes. All T1–T5 unstarted; T4/T5 probe-gated (probes 10/11 unrun). The link to the master goal (mechanistic continuity) is **not** in the source; only «turn-loop economics», which is not the goal invariant. Not invented for the author.

## 4. Kernel repair — independent re-verification (R2)

| claim (plan) | instrument | result |
|---|---|---|
| source checkpoint `9695d18b9e` | `git log` | ✓ present (HEAD~1 region) |
| `handoff-manifest.json` `source_pins` = real files | `sha256sum` vs manifest | ✓ all match (source.py `a9ec70c2…`, model.py `15ad2add…`, evidence.py `0048fc50…`, validate.py `150a41d4…`, addons×4, mcp-client.ts `a4271f11…`, sqlite-pack.ts `f8efef16…`, explore.txt `35fe3185…`) |
| 4 renderer receivers match the manifest | `sha256sum` vs manifest `receivers[].sha256` | ✓ product `bc7d5b8f…`, claude `d33326b6…`, codex `1a3a754c…`, cursor `a3c760ed…` — all reproduce |
| archive holds complete state/stdout, not tail-only | `ls` | ✓ 23 checks, 23/23 have `state.json` + `stdout_text.log`; `manifest.json` lists each with size+SHA-256 |
| guards landed (K02/K03) | `codegraph_explore` `validate_kernel` | ✓ `validate.py:71-81` — wildcard source lawful only on the interrupt `*→G9`; terminal has no outgoing edges; undeclared side edge refused |
| **no unconfirmed closed delivery** | plan source | ✓ A1/A2 are `[ ]`; README of the archive states «ADID release/install … ещё не подтверждён этим архивом» |

**Closure verdict on kernel repair: NOT SUCCESS** — R2 is a *build/equal-receivers* proof; the ADID delivery (A1/A2) is unexecuted and independently unverified. This matches the plan's own admission.

## 5. Tool findings / limitations (for the parent to re-check)

1. **`codegraph_explore` is bound and answered** — the receipt is §4 (`validate_kernel`, `modeToMcpCall` @ `mcp-client.ts:81`, `mcpTouchQueryThenSqlitePack` @ `:218`, `extractPathsFromText` @ `sqlite-pack.ts:44`, `masterPlanCoverage` @ `plan-status.ts:581`). It is a structural index, **not** a source-comparison oracle; source identity was proven by SHA-256 readback.
2. **`planstatus` not run** — a read-only explorer cannot execute the product tool; the box counts here are re-derived from the files and agree with the render (18 active / 99 open).
3. **Render is testimony** — the MASTER body is generated from the same files; where it looked inconsistent (18 vs 20) the files resolved it (§1). No render↔source disagreement remains.
4. **Long plans read partly** — `reasoning-stream` (950 ln), `cua-windows` (29 boxes), `robot-installer` (783 ln) were read through their head + task/box sections; box-level verdicts rest on those sections. A miss here is a *scope* limitation, named, not a claim of completeness.

## 6. Conclusion (testimony to the parent — not a verdict)

- **Inventory:** 20 root plans = 20 named in MASTER; **unaccounted: none**. Falsifier #1 did not fire. Delta vs the prior snapshot: `sv-chain` → `plans_completed/`.
- **Aligned** CORE: `kernel-contract-repair` (in-flight), `plan-hygiene`, `mstar`, `codegraph-impact`, `kernel-candidate`, `specs-inventory`, `supersede`. PARTIAL: `reasoning-stream`, `h2`, `memory-orphan`, `database-truth`, `tool-description`, `robot-installer`, `shelf-triage`, `cua-windows`, `cua-supply-chain`, `org-portable`, `files-api`. **UNALIGNED (link not evidenced): `anthropic-cache-breakpoints`, `mcps-connector-manager`** — `Pending` ≠ no strategy; the link is simply not in the source.
- **Stale-completion (checked box without implementation/oracle):** no *full* stale-complete found in the active root — an **empty result**, bounded by the files read. Nearest named case: `files-api` T1 (effect deferred, plan-stated). Separate class: completed-on-owner's-word without a machine record (shelf `to_be_confirmed/`) — a *record* debt, not a proven falsehood.
- **SUCCESS feasibility:** the portfolio contains one in-flight CORE plan whose delivery is unverified (kernel repair A1/A2) and two UNALIGNED plans; a portfolio audit that forbids SUCCESS over unaligned/unverified work therefore **does not pass SUCCESS today**. This is testimony; the parent re-checks.
