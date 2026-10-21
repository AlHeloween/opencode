# Plan maintenance — MASTER_PLAN, JOB FAILED, commit vs closure (moved from AGENTS.md, 2026-10-13)

The rules stay in AGENTS.md § Plan Maintenance; this file is the record — the owner's wording, the measured numbers, and the rationales verbatim. *(Links inside the moved text use repo-root-relative paths, as they were written in AGENTS.md.)*

This file says **how** to work; [`plans/MASTER_PLAN.md`](plans/MASTER_PLAN.md) says **what is being worked on
and why, right now**. It lives WITH the plans because that is where a reader looks — «master plan должен быть
в планах, а не в корне иначе его никто читать не будет» (owner, 2026-09-30) — and it is canon, not a plan: the
plan scanner skips it by name (`NON_PLAN_FILES`) so neither the status nor `reconcilePlans` can ever file the
map of all work into `plans_completed/`. It is the entry point for any agent — this repo's, or a different
environment that simply read the repository — and it must be readable by an agent that has never seen this
session, without guessing:

## The renderer WORKS — RUN IT, never hand-maintain the body

**The renderer WORKS — RUN IT, never hand-maintain the body.** `svm render` (plan S4) rewrites everything below
the `<!-- generated below -->` marker from the plan files + the SVM store, and preserves the hand-owned head
verbatim. **Measured 2026-10-01:** two consecutive renders reported the same 27 595 B, and the second one's own
`gapsBefore` was `[]` where the first had NAMED two unmapped plans — the run closed the gap and the check
confirmed it closed, which is why the coverage claim is two-sided and not a silence. `planstatus` prints that
coverage line whether it is clean or not («Master plan: every plan under plans/ is named in
plans/MASTER_PLAN.md.»), by design: a check whose silence cannot be told from its absence is not a check.
**What is still open is the VECTOR AUTHORING, not the renderer** — a render prints `MISSING` where a source has
none, and as of 2026-10-01 that is 2 plan SVs, 65 task SVs and 94 manifests. Those are authored in the plan
files and the SVM store, never here; the map only PRINTS them.
*(History: this pointer did not exist until 2026-09-30 — AGENTS.md never mentioned `MASTER_PLAN.md`, so the
"any agent picks it up on autopilot" property held only for an agent that happened to list the repo root.)*

## JOB FAILED — a plan is not finished by shipping code

1. **No confirmed box.** The plan still carries `- [ ]` for work that is actually done, or `[x]` for work that is not. Both are the same lie in opposite directions, and both make the plan unreadable to the next cycle. A confirmed box means **the acceptance declared in the plan was run and passed** — never that the code "looks right".
2. **The plan is still in `plans/`.** After the last open item closes, the file moves to `plans_completed/` **in the same change**. Tool: `reconcilePlans`. Known blindness: `collectPlans` is flat (no recursion), so a plan inside `plans/emergency/`, `plans/futures/` or any archive subdirectory is **invisible** to the mover and must be moved by hand — that is not an excuse, it is part of the job.
3. **No commit for the plan.** One plan's work lands as one coherent commit (or a short series that names the plan), so plan and diff can be read together. Work spread over unrelated commits with no reference to the plan is indistinguishable from a lost job.
   Robots sharing one checkout commit through their own index — `python scripts/commit_own.py --session <id> -m <msg> -- <paths>` (plan plans/2026-10-16_private-index-commit.md) — so a commit carries only its own paths; a bare `git commit` sweeps other agents' staged work (t66). A `_progress_log.md` row goes only through the log route — `python scripts/commit_own.py --session <id> -m <msg> --append _progress_log.md=<row-file>` (t131: the route appends the row to HEAD's bytes and refuses deletions and foreign hunks; never stage the log whole, never hand-build a patch for it).
4. **Not named in `plans/MASTER_PLAN.md`.** The map's body is generated FROM the plan files, so a plan the map does not name is an unfinished record — a note nobody picks up, not a plan — and `plans/` fills with **operational debris**. The folder is the direction, not a scratchpad: a note that belongs to no goal is not a plan and has no business holding a plan file (its home is `_progress_log.md` or memory). Run `svm render` in the same change that creates or renames one; `planstatus` prints the coverage line either way, so its silence can never be mistaken for its absence. Owner, 2026-10-12, verbatim: «если план висит в plans и это не часть мастера а просто недоделанная запись это по определению неверно» · «Иначе получается папка планов забивается операционным мусором.»

Owner, 2026-09-22, verbatim: «Отсутствие подтвержденной галки в плане, не перемещение в plans_completed или отсутствие общего коммита на план — считается **JOB FAILED**.»

**Why this is a failure and not bookkeeping.** A plan whose boxes, folder and commit disagree with its code has to be re-derived from scratch by the next cycle — the cost is paid again at every hand-off. Measured 2026-09-22: the project's own status footer read `152/181 plans 395/576 tasks (84%) misplaced:23` while **181 tasks sat open in the visible set alone**, ~121 archived plans were outside the count entirely, and 23 files contradicted their own placement. That footer is what "eternal DRAFT" looks like from the outside.

## A commit is NOT closure

Owner, 2026-09-22, verbatim: «коммит не сопровождаемый подтвержденной артефактом галкой в плане или перемещением плана в plans_completed, при условии полной завершенности — поводом для G9 не считается.»

**Why.** A commit is a change to the TREE; closure is a statement about the PLAN. Taking the first for the second is exactly how a session lands a dozen commits and leaves every plan open — the "eternal DRAFT" measured the same day above. When reporting, name the box and its artifact; if there is no box, the work is not closed, whatever the commit says.
