<!--
intention: fossilgrep searches only FILE CONTENT across history -> it searches check-in COMMENTS too (the
semantic dominants live there), and the project's own snapshot.fsl becomes a local cell (wiki card + automatic
chat report per turn) with a read-only cross-project federation over `fossil all list`
-->
<!-- goal_sv: Keywords: fossilgrep-comments 0.30, project-cell 0.25, semantic-timeline 0.20, federation 0.15, read-only 0.10
Semantic dominant: The snapshot timeline becomes searchable by MEANING through its check-in comments, and each project's fossil becomes a local cell (wiki + chat) readable across the syndicate.
md5: 7a2b4c6d8e0f1a2b3c4d5e6f7a8b9c0d
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
-->

# t53 — project fossil as local cell; fossilgrep searches meaning

Owner, 2026-10-15, verbatim: «у нас есть fossil каждого проекта — было бы неплохо там сделать вики под проект, чат,
тикеты и прочее, так сказать сделать локальную ячейку, заполнить информацию о проекте и время от времени уделять
поддержанию его в порядке. В чате все роботы которые работали над проектом пишут краткий отчет о том что они делают,
все изменения фоссила у нас имеют семантическую доминанту — теперь fossilgrep реальная сила — так что надо бы это
указать в описании этой тулзы».

## Prior art (REUSE.BEFORE)

- `packages/opencode/src/tool/fossilgrep.ts` — existing tool, `fossil grep` over file versions only.
- `docs/fossil-snapshot.md` §2.0.1 — the full SV rides the check-in comment (`auto-snapshot sv:<md5>
  dominant=… Keywords: …`); the SQL to read comments is documented there.
- `external/fossil/fossil-src-2.28/` — pinned source, version-matched to the shipped fossil.exe 2.28.
- `plans/2026-10-10_organization-wiki-and-reporting.md` (moved) — the org-level wiki/reporting plan; this plan
  is the PER-PROJECT cell, org stays the cross-project authority.
- Measured on this repo's snapshot.fsl (2026-10-15, `fossil sql` read-only): 418 check-ins, 203 carry
  `sv:`+`dominant=` (48.6%), 215 bare `auto-snapshot`; max comment length 734 chars.

## Grounding facts (measured this session, read-only)

| fact | value | instrument |
|---|---|---|
| check-ins | 418 | `fossil sql "SELECT count(*) FROM event WHERE type='ci'"` |
| carrying `sv:` | 203 (48.6%) | `… AND comment LIKE '%sv:%'` |
| bare `auto-snapshot` | 215 | `… AND comment NOT LIKE '%sv:%'` |
| comment max length | 734 chars | `max(length(comment))` |
| `fossil all list` | 63 repos: 54 `snapshot.fsl`, 9 other (4 forum-probe scratch, 1 org-forum temp, `~/.org/org.fossil`, 3 experiment scratch) | `fossil all list` + findstr |
| wiki events in snapshot.fsl | 0 | `… WHERE type='w'` |
| ticket events in snapshot.fsl | 0 | `… WHERE type='t'` |
| timeline comment truncation | at ~120 chars in default format; `--oneline` truncates too; `--medium`/`--full` print the comment in full | `fossil timeline --medium` |
| changed files per check-in | `mlink` JOIN `filename` (fid=0 ⇒ deleted) | `fossil sql` |

## Phase A — fossilgrep searches meaning

- [x] A1 RED: test asserting a comment-search mode exists; fixture repo with known comments (one carrying
  `dominant=`, one bare). RED confirmed: 0 pass / 6 fail — `searchComments is not a function` (run 20261015T074521Z_c5efdec5).
  <!-- sv: comment-mode, red-first, fixture-repo -->
- [x] A2: implement `mode: "comments"` in fossilgrep.ts — read-only via `fossil sql -R <repo>` over
  `event JOIN blob` (the documented read path), regex over comment text; returns check-in hash, date,
  dominant line, changed files (mlink). No repo writes. Wired into the TOOL execute too (mode +
  allProjects params) — the model can call it. <!-- sv: comment-mode, read-only-sql, mlink-files -->
- [x] A3: fossilgrep.txt states the semantic-timeline contract: every snapshot check-in carries the turn's
  vector (dominant + keywords + md5) — 203 of 418 measured on this repo — so the timeline is searchable by
  MEANING; bare `auto-snapshot` exist. <!-- sv: description-contract, measured-share -->
- [x] A4: typecheck exit 0 + tests 6/6 (run 20261015T075444Z_1002ea99) + commit cb89516ada naming this plan.
  <!-- sv: oracle, commit -->
## Phase B — the local cell (design first, then first slice)

- [ ] B1 grounding: does wiki/ticket/chat data in snapshot.fsl survive the snapshot lifecycle (revertTo,
  rebuild, re-init, silent close+delete)? Answer with evidence from `docs/fossil-snapshot.md` §7 (HISTORY_INVALID
  reinit path) and `src/snapshot/fossil.ts` (ensureInit, checkout, extras cleanup). Wiki/ticket events live in
  the SAME sqlite file the snapshots live in — a reinit DELETES them. Record the verdict in this plan.
  <!-- sv: lifecycle-survival, evidence-first -->

## B1 verdict — measured + read from code (2026-10-15)

**The cell lives IN snapshot.fsl — no sibling repo.** Evidence:

1. ✓ The normal lifecycle never touches non-checkout data: `track()` → `fossil commit` (working-copy
   files only), `checkoutTo` → `fossil checkout --force <leaf>` (working-copy files only), `revertTo`
   → same checkout path. No `fossil rebuild`/`prune`/`delete` call exists anywhere in
   `src/snapshot/**` (grep). Wiki/ticket events live in the same SQLite file and are not checkout
   state — `docs/fossil-snapshot.md` §3: "History in .fsl is not erased".
2. ✓ The "silent close+delete" is checkout-marker cleanup only: `fossil close --force` +
   `clearCheckoutMarkers` remove `_FOSSIL_`/`_fossil` in the worktree (fossil.ts:66-71, 350-351,
   376-377) — never the repo file.
3. ✓ The ONE destructive path is corruption reinit (fossil.ts:423-437): backup `snapshot.fsl` →
   `.bak.<ts>`, remove, reinit, write `HISTORY_INVALID.json`. That destroys cell data — but it is
   exactly as fragile as the undo timeline itself, it keeps a full backup, and the wiki card is
   re-derived (create-if-missing at the next cell post), so the card self-heals; chat technotes are
   historical and lost only on that same corruption event that already loses the timeline.
4. ✓ Measured headless writes: `fossil wiki -R <repo> create Project <file> --mimetype
   text/x-markdown` creates, `list` shows it, `export Project -` reads it back (probe on a fixture
   repo, run 20261015T080148Z_98b51dde). Technotes: `fossil wiki create <name> <file> --technote now
   --technote-tags chat` — the exact shape org.py's `create_technote` uses in production.
5. ✓ org.fossil (the organization) already carries its own cell: 183 wiki events, 322 ticket events
   (read-only count). The per-project cell does not duplicate it: local wiki/chat/tickets stay
   per-project; cross-project delegation stays in org.

## B2 design — roles, one copy each

- **wiki** — one page `Project` per project in snapshot.fsl. Content: POINTERS ONLY (one-copy
  rule) — each bullet included only when its target exists on disk at generation time: AGENTS.md,
  README.md, docs/README.md, plans/MASTER_PLAN.md, plus the chat/tickets read routes. Never
  restates their content.
- **chat** — one TECHNOTE per turn (`--technote now --technote-tags chat`), comment
  `chat <agent>: <dominant ≤80ch | no vector declared> (session <id8>)`, body carries agent,
  session, time, dominant. Fired by the runtime at the turn-end boundary (processor `turnEnds`,
  the same place the snapshot commit is forked) — once per turn, background, failures logged never
  thrown. The dominant comes from the same `vectorSign` the commit already carries. Plan ref:
  RESIDUAL — the runtime has no session→plan binding to read cheaply; the dominant is the turn's
  focus and the plan lives in the session transcript.
- **tickets** — DECIDED, owner 2026-10-15 verbatim: «Локальные тикеты через fossil ticket add, делегирование в org».
  Write path still to build (queued: local-ticket-write). Original proposal: local tickets live in snapshot.fsl's own ticket
  table (default fields, `fossil ticket add/set -R`); cross-project delegation stays in org.fossil
  (its schema already carries root_task/parent_task/lease fields). No second delegation system.
- **upkeep** — the card is create-if-missing at the first cell post of each process (self-healing
  after a reinit); the measurable «in order» predicate: the `Project` page exists AND ≥1 chat
  technote exists. A deeper periodic audit is the orchestrator's check, not a new scheduler.
- [x] B2 design (in this plan, above): roles without a second copy —
  **wiki**: one «Project» card per project pointing to AGENTS.md/README/docs (one-copy rule, never restating);
  **chat**: every robot session posts a short report at turn end AUTOMATICALLY (runtime hook, once per turn,
  like the snapshot boundary — the dominant is already in the check-in comment at that moment);
  **tickets**: local tickets live in snapshot.fsl's own ticket table; cross-project delegation stays in
  org.fossil — no second delegation system; **upkeep**: the orchestrator's periodic check with a measurable
  «in order» predicate (wiki card exists + chat has entries this week + no ticket older than X unresolved).
  <!-- sv: one-copy-rule, turn-granularity, no-second-delegation -->
- [x] B3 first slice: the wiki card (one page, markdown, written once per project) + the automatic chat post
  at the turn boundary — cell.ts (plain async, explicit deps) + Snapshot.cellPost (state wrapper under the
  per-repo semaphore) + processor fires it at turnEnds forked background. <!-- sv: first-slice, wiki-card, chat-post -->
- [x] B4 cell tests: fixture repo — card created + idempotent, technote per post, repo-missing no-op.
  4/4 (run 20261015T081858Z_c1c55cfe). <!-- sv: cell-oracle -->
- [x] B5 typecheck exit 0 + processor-effect 20/20 (run 20261015T082014Z_92d01fcd) + commit 312b650d30.
  <!-- sv: oracle, commit -->

## Phase C — the federation (owner, same day)

- [x] C1 design: `fossil all list` is the registry (63 measured: 54 snapshot.fsl, 9 other). Cross-project
  search = fossilgrep comment mode over ALL registered snapshot.fsl repos (`allProjects: true`); a repo that
  fails to open is NAMED in the result (auditable zero, never a silent skip). Read-only, local files only,
  no fossil sync/push. <!-- sv: registry, auditable-zero, no-remote -->
- [x] C2 implement: cross-project comment search (fossilgrep `allProjects`) + the cell read route — NEW TOOL
  `fossilcell` (actions list/wiki/chat/tickets; registry + builtin + dsml-normalizer wired; findFossil
  reused from fossilgrep). <!-- sv: cross-project-search, read-route -->
- [x] C3 federation tests: registry parse + project-name derivation (both layouts) + cross-repo search +
  failed-repo-NAMED. 5/5 (run 20261015T083004Z_e08da434); all three fossil suites 15/15 (run
  20261015T083017Z_30bd9988); description-integrity caught `allProjects` missing from the txt — fixed, 5/5
  (run 20261015T083129Z_ee5c4fe9). <!-- sv: federation-oracle -->
- [x] C4 typecheck exit 0 (run 20261015T083144Z_d2560914) + commit naming this plan. <!-- sv: oracle, commit -->

## Smoke Tests (required — PRE_FLIGHT gate)

### Baseline (run before any implementation edit)
| # | Command (cwd) | Expected now | Actual [Exact] |
|---|---------------|--------------|----------------|
| 1 | `cmd_runner start --cwd packages/opencode -- bun test test/tool/fossilgrep.test.ts` | RED: no comment mode | (record from tail) |

### Post-implementation oracles
| # | Command (cwd) | Pass criteria |
|---|---------------|---------------|
| 1 | same | comment mode returns fixture check-ins by dominant; bare ones excluded unless pattern matches |
| 2 | `cmd_runner start --cwd packages/opencode -- bun typecheck` | exit 0 |

### Gate
- [ ] Smoke requirements written
- [ ] Baseline recorded [Exact]
- [ ] Implementation only after baseline
- [ ] Post-impl smoke passed before [x]

## Rules honored
- Never full `bun test`; one file per call via cmd_runner; never bin/; no build (fleet lead builds);
  no fossil CLI mutate paths on an unproven repo (Phase B grounding first); commit only my paths.
