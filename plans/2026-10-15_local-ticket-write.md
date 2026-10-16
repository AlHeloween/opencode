<!--
intention: the project cell is read-only (t53: fossilcell reads list/wiki/chat/tickets) -> THIS project's cell accepts local ticket add/set through fossil ticket add/set under the same per-repo semaphore, foreign writes refused, cross-project delegation stays in org.fossil
-->
<!-- goal_sv: Keywords: local-tickets 0.35, ticket-write 0.25, per-repo-semaphore 0.20, own-cell-only 0.12, org-delegation-split 0.08
Semantic dominant: This project's cell gains a ticket write route under the snapshot semaphore while foreign cells and cross-project delegation stay out.
md5: c62d4e8a1f3b5c7d9e0a2b4c5d6e7f80
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t62 — local tickets in the project cell: the write route

Owner, 2026-10-15, verbatim: «Локальные тикеты через fossil ticket add, делегирование в org».
The cell exists (t53: `fossilcell` reads list/wiki/chat/tickets of any project's snapshot.fsl,
read-only; plan `plans/2026-10-15_project-fossil-cell.md`, tickets row now DECIDED).
The write side does not exist yet. The kernel add-on line naming the split is a SEPARATE
kernel task — do not touch prompt_kernel/.

## G1 grounding (measured this session, read-only)

| fact | value | instrument |
|---|---|---|
| cell write fns | `cellPost`, `ensureWikiCard`, `postChatReport` in `packages/opencode/src/snapshot/cell.ts`; plain async, explicit deps `(fossilBin, repoPath, worktree)`; failures logged never thrown | read cell.ts |
| per-repo semaphore | `locks: Map<string, Semaphore>` + `locked = (fx) => lock(fossilDir).withPermits(1)(fx)` in `packages/opencode/src/snapshot/fossil.ts:164-181`; `cellPost` runs inside `locked` (fossil.ts:697-712) | read fossil.ts |
| ticket CLI syntax | `fossil ticket add FIELD VALUE …` prints `ticket add succeeded for <uuid40>`; `fossil ticket set UUID FIELD VALUE …` (prefix GLOB); default fields include `type,status,subsystem,priority,severity,foundin,resolution,title,comment`; `--uuid-override` pins uuid; needs a row in `user` (else `no such user`) | `external/fossil/fossil-src-2.28/src/tkt.c:1560-1855` |
| `-R` placement | `wiki -R <repo> create …` measured working (cell probe, plan B1); org.py proves trailing `-R <repo> -U <user>` works for `ticket set` | read cell.ts:97-100, scripts/org-genesis/org.py:123-130 |
| tool wiring triple | registry import + `builtin: […]` entry (`src/tool/registry.ts:62,213,333,388`) + `DEFAULT_KNOWN_TOOL_IDS` (`src/util/dsml-normalizer.ts:131`); `fossilcell` id is `fossilcell` (lowercase alphanumerics) | grep |
| tool context | `Tool.Context` carries NO worktree/project (`src/tool/tool.ts:16-27`); tools read own scope service-free via `Instance.worktree` / `Instance.project` (`src/project/instance.ts:109-114`, read.ts pattern) | read tool.ts, instance.ts |
| own repo path | `fossilDir = <worktree>/.opencode/data/fossil/<project.id>/snapshot.fsl` (fossil.ts:176-178) — the tool can build the identical path from `Instance` without new discovery | read fossil.ts |
| lock proof precedent | `test/snapshot/fossil-lock.test.ts` proves the semaphore with a stubbed spawner (peak in-flight == 1, mutation falsifier: make `locked` identity → red) | read fossil-lock.test.ts |
| real-fossil cell precedent | `test/snapshot/cell.test.ts` uses the real binary on a fixture repo (init/open/commit), no mocks | read cell.test.ts |

## G2 decision — where the write route lives

**Extend `fossilcell` (one tool, read + write verbs).** Why, in repo-convention terms:

1. Tool-name economy: a sibling needs a new lowercase-alphanumeric id + the same triple
   wiring (registry import, builtin entry, dsml-normalizer entry) t53 just added — double
   audit surface for one table.
2. One description surface: `fossilcell.txt` already contracts "local only — cross-project
   delegation lives in org.fossil"; the write verbs inherit it in one place.
3. No new discovery: write verbs target the OWN repo built from `Instance` exactly as the
   snapshot service builds it; a `project` param naming anything else is refused.
4. The semaphore forces a service path anyway: the per-repo `Semaphore` map lives inside
   `snapshot/fossil.ts`, so the write MUST go through new `Snapshot` service methods
   (`ticketAdd`/`ticketSet` under `locked`). A sibling tool would need the identical path —
   no separation benefit.

New `fossilcell` actions: `ticketadd` (title + optional comment/status) and `ticketset`
(uuid prefix + optional title/comment/status). Both resolve the OWN repo only; both fail
closed (no unlocked direct fossil write from the tool — service absent ⇒ error, never a
bypass). Cross-project delegation is NOT here — it stays in org.fossil (`org.py delegate`).
Writing another project's cell is refused.

## Tasks

- [x] T1 RED: three test files asserting the missing write route — `test/snapshot/cell-ticket.test.ts` (real fossil: addTicket/setTicketFields import), `test/tool/fossilcell-ticket.test.ts` (schema accepts `ticketadd`/`ticketset`; pure own/foreign helpers), `test/snapshot/cell-ticket-lock.test.ts` (service `ticketAdd` + concurrent `track` under stubbed spawner). RED recorded 2026-10-16: cell-ticket `Export named 'addTicket' not found` (run 20261016T010134Z_2d6bf838, exit 1); fossilcell-ticket `Export named 'ownRepoPath' not found` (run 20261016T010200Z_d26e708d, exit 1); lock `snapshot.ticketAdd is not a function` (run 20261016T010214Z_c416f66d, exit 1). <!-- sv: red-first, three-oracles -->
- [x] T2 cell.ts: `addTicket` + `setTicketFields` — plain async, explicit deps like the existing fns; `ticket add` uuid parsed from `ticket add succeeded for <uuid>`; failures logged, null/false never throw; no `-U` (repo default user, same as commit path). Plus pure `ticketAddArgs`/`ticketSetArgs`/`parseTicketAddUuid` shared with the service. <!-- sv: cell-write-fns, plain-async -->
- [x] T3 snapshot service: `ticketAdd`/`ticketSet` on `Snapshot.Interface` + `locked` wrappers in fossil.ts (same `lock(fossilDir)` as `cellPost`); fail-closed when snapshot disabled/repo absent (undefined/false, logged). <!-- sv: locked-writes, same-semaphore -->
- [x] T4 fossilcell verbs: `ticketadd`/`ticketset` resolve OWN repo from `Instance` (`worktree/.opencode/data/fossil/<project.id>/snapshot.fsl`); `project` param present and ≠ own name ⇒ refusal output; service absent ⇒ error (never unlocked write); txt documents the split (local → cell, cross-project → org.fossil). Pure `ownRepoPath`/`isForeignProject` exported for tests. <!-- sv: own-cell-only, fail-closed -->
- [x] T5 GREEN + oracle: three files green (cell-ticket 4/4 run 20261016T010756Z_68983209; fossilcell-ticket 6/6 run 20261016T010703Z_f152237a; lock 1/1 peak==1 run 20261016T010836Z_f102f64d), focused regression green (cell 4/4, federation 5/5, fossil-lock 1/1, description-integrity 5/5), `bun typecheck` exit 0 (run 20261016T011037Z_88f2f84b), commit 35ac5a7c2b naming this plan. Build: `_build.ps1` twice (runs 20261016T011228Z_dbc6d925, 20261016T011403Z_ac3c511b) — vite + opencode-windows-x64 + smoke (10.0.1363/10.0.1364) PASS, final Copy-Item to dist/bin blocked by a live process holding dist\bin\opencode.exe (another robot in this shared tree). RESIDUAL: dist candidate not refreshed by this run. <!-- sv: oracle, commit, build -->

## Smoke Tests (PRE_FLIGHT gate)

### Baseline (before any edit)

| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---|---|---|
| 1 | `cmd_runner start --cwd packages/opencode -- bun test test/snapshot/cell-ticket.test.ts` | RED: file missing | (record from run) |
| 2 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/fossilcell-ticket.test.ts` | RED: file missing | (record from run) |

### Post-implementation oracles

| # | Command (cwd) | Pass criteria |
|---|---|---|
| 1 | same cell-ticket file | add → uuid + sql read-back; set → sql read-back; unknown uuid → false; missing repo → null/false, no throw |
| 2 | same fossilcell-ticket file | schema decodes new verbs; foreign project refused; own path helper exact |
| 3 | `cmd_runner start --cwd packages/opencode -- bun test test/snapshot/cell-ticket-lock.test.ts` | concurrent ticketAdd + track: peak fossil in-flight == 1, both completed |
| 4 | `cmd_runner start --cwd packages/opencode -- bun typecheck` | exit 0 |
| 5 | `pwsh -NoProfile -File _build.ps1` (repo root, once, via build lock) | state.json success |

### Gate

- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## Rules honored

- Never full `bun test`; one file per call via cmd_runner; never bin/; never `--no-verify`, never `--amend`; stage by path; `_progress_log.md` appended (both entries kept on conflict); index.lock → wait 5 s and retry.
- Trials/profiling go to `researcher_agent`.
- Bounds: steps 50, tools 120, loops 3, depth 2, time 3 600 000 ms.
