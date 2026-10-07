# Robot delegation, orchestration and scheduling — using AGI mode and automode in full

> **DEFERRED 2026-10-07 — overtaken.** The robot route became the bridge + worktree server API (`7ad9f71fb0`,
> plans/postponed/2026-10-02_one-server-per-worktree.md) and the organization moved to Fossil tickets with leases
> (plans_completed/2026-10-04_fossil-agent-organization.md). The Claude skill box is done (`ef3df9d0e2`, R2a run
> `20261002T044631Z_3b71feb4`). Living seeds carried to plans/futures/2026-10-07_fossil-organization-roadmap.md:
> S2 ask=deny / pre-authorization (`orchestrator.txt:7` still asks «Do you approve this plan?») and S3 the worker pool.
> reopen_when: AGI mode itself is picked up again.

<!-- intention: Claude/Codex frame and verify while the opencode robot executes, unattended and in parallel where safe -> a Claude skill + a Codex binding that dispatch bounded tasks to the robot, and a staged path to AGI-mode parallel workers and a local scheduler -->

- status: DRAFT (owner-directed design, 2026-09-30; nothing implemented yet)
- sv: { keywords: { robot-delegation 0.30, agi-orchestrator 0.25, unattended-blockers 0.20, scheduler 0.15, worker-pool 0.10 },
        dominant: "The robot runs bounded tasks unattended — one cmd_runner per worktree, orchestrator-driven workers — while Claude only frames and verifies." }
- owner, 2026-09-30: «сделать скилл для claude чтобы делать новые сессии для нашего робота, чтобы минимизировать
  нагрузку на твою модель… приблизительный скилл для кодекса… чего нехватает чтобы отправлять задания роботу через
  местный шедулер»; then «1 cmd_runner на worktree, если в этом worktree несколько задач система вполне может их
  обрабатывать параллельно… там есть режим оркестратора и автоматический режим».

## Grounded facts (read in code 2026-09-30 — re-verify before building on them)

- `opencode run` (`packages/opencode/src/cli/cmd/run.ts`): `run [message..]` with `--agent`, `--model`,
  `--variant`, `--session/--continue/--fork`, `--format json`, `--file`, `--title`, `--dir`, `--attach <server>`.
  Headless asks are AUTO-REJECTED (lines 523-541); `question`/`planenter`/`planexit` denied (339-355);
  `--dangerously-skip-permissions` approves everything not denied (too broad). Exit code reflects setup errors
  only (process.exit(1) at 301/313/331/336/613/619), not task acceptance.
- Sanctioned launch point: `dist\bin\opencode.exe` (never `bin/` — AGENTS forbidden_actions).
- AGI mode and `/automode` are TUI-SIDE state machines: `tui/context/agi-mode.tsx`, `automode.tsx`,
  `automode-logic.ts`. `run` does NOT drive them — the entry for unattended AGI is a live TUI hosted by
  cmd_runner (ConPTY) with `/agi` or `/automode` sent through its inbox.
- AGI loop: `ORCH_BUSY → ORCH_DISPATCH → WORKERS_BUSY → WORKERS_COLLECT`; directives
  `<workerN_<sessionID>>…</workerN_…>` (agi-mode.tsx:355-357), dispatched in a loop (:614), waits for ALL
  `activeWorkers`; MAX_TURNS=100 (:166), MAX_RUNTIME 24 h (:169); reconcilePlans each collect; state in
  `.opencode/data/state/agi-state.json`.
- ONLY TWO sessions are created — `main` and `orch` (agi-mode.tsx:737, :753); «future sessions» (:6) is a
  comment. Effective parallelism today = one worker + its `task` subagents + background jobs.
- `/automode` exits on: a plan LEAVING `plans/` (default), all plans moved (`all`), or an iteration count (`N`).
- Orchestrator prompt (`agent/prompt/orchestrator.txt:7`) ends every plan with «Do you approve this plan?».
- docs/agi-workflow.md:144 — an ask left pending keeps the loop in WORKERS_BUSY until the user answers.
- Kernel G7 «One bounded task open at a time. Two in flight share one oracle → neither attributable» — the
  candidate's «concurrent children require disjoint effects, reserved budgets and separate oracles» was NOT ported.

## Unattended blockers

| # | blocker | fix direction |
|---|---|---|
| B1 | one worker session only | worker pool: create up to K sessions per directive `workerId` |
| B2 | orchestrator asks «Do you approve this plan?» every cycle | pre-authorization marker in the plan header (owner approval + envelope); orchestrator skips the ask for approved plans |
| B3 | a pending ask stalls the whole loop | unattended policy: ask = deny (as `run` already does), the decision goes to SVM `waiting-on-user` |
| B4 | mode exit leaves TUI + cmd_runner alive | external dispatcher reads the stop signal (plan moved / agi-state.json) and `jobkill`s |
| B5 | parallel workers in ONE tree vs kernel G7 | disjoint paths + a separate oracle per directive; ONE committer (orchestrator); port the candidate's G7 clause |
| B6 | no task queue: `SVMRecord.state` has no `ready` | add `ready` + an eligibility rule; the dispatcher takes the next ready task |
| B7 | no per-task permission envelope for headless | e.g. `run --envelope <file>` → `session.create({permission})` (the kernel's G4 envelope made executable) |
| B8 | no timeout in `run`; outcome not in the exit code | cmd_runner / scheduler time limit; outcome read from SVM (`verified` + evidence, or `blocked` + lift signal) |
| B9 | no owner channel for decisions and digests | digest file / PushNotification; decisions accumulate as `waiting-on-user` |
| B10 | binary + API keys for the scheduled context | owner's procedure (bin/ is the owner's runtime) |

## Stages (each measured before the next)

- [ ] S1 — no code: one worktree, one cmd_runner hosting `dist\bin\opencode.exe`, `/automode` on ONE plan the
      owner approved beforehand; Claude writes the brief and runs the oracle. Record where it stalls.
- [ ] S2 — pre-authorization marker (B2) + ask=deny policy (B3). Acceptance: an AGI cycle completes with no
      human answer and no self-authorization.
- [ ] S3 — worker pool (B1) with disjoint paths and per-worker oracles (B5); kernel G7 clause ported through the
      pipeline. Acceptance: two workers edit disjoint files in one tree, each oracle attributable, one commit per plan.
- [ ] S4 — scheduler: `schtasks` + a READ-only dispatcher (queue B6, lease one-robot-per-tree, exit detection B4,
      timeout B8, digest B9). Acceptance: a scheduled run takes a ready task, finishes, reports, releases.
- [x] (done: `ef3df9d0e2`, revised through `0bdf828759`) Claude skill `.claude/skills/robot/SKILL.md` (brief = plan task + SV + oracle + prediction; launch via
      cmd_runner/run_in_background; read only the final message + git diff; verify with the oracle itself;
      `--session` to continue; never bin/, never --dangerously-skip-permissions). WRITTEN 2026-09-30, flags
      re-read in `run.ts` ✓; not smoke-tested — the box waits for the Skill smoke below. Models: free Zen
      (in-app only) for plumbing; real work on the funded pair GLM-5.3-Flash-BF16 (HF) + DeepSeek V4.1 Flash
      from ~2026-10-01 (owner: «для реального workflow бесплатные модели не вариант»).
- [ ] Codex binding — a DELEGATION/G7 line in `addons_codex.py` (installed to ~/.codex/AGENTS.md). Whether the
      installed Codex reads `$CODEX_HOME/skills/` is UNVERIFIED.

## Scaling — 100-1000 robots (owner, 2026-09-30)

Owner: «у Claude подписка на workspace вполне нормальная для скейлинга просто буду докупать рабочие места и
получим вполне непротиворечивый цикл чтобы ранать 100-1000 таких роботов». The loop: Claude seats frame and
verify, robots execute on the funded models. What decides whether it holds (Hypothetical until S1-S4 measure it):

- **The two numbers that size it** — measured per verified task from the first real run on: Claude tokens per
  verified task (brief + read-back + own oracle; plan limits via `get_usage`) and robot $ per verified task
  (HF / DeepSeek balance before/after). Robots per seat = seat budget / Claude cost per task; nothing is sized
  before these exist. A THIRD number decides whether the loop is closed at all: **owner touches per verified
  task** (answers, restarts, manual fixes). Owner, 2026-09-30: «любая тема должна быть экономически
  целесообразной и достаточно замкнутой чтобы не трахать мозги обслуживающему персоналу». Target for the
  routine class: → 0, with the decisions that remain batched into the digest (B9), never interrupting a run.
- **The verifier is the bottleneck, by design.** A robot result nobody verified is testimony; scaling robots
  without scaling verification scales unverified output. Tasks whose oracle is a command (tests, a read-back)
  verify cheaply — they are the ones that scale.
- **Consistency needs one arbiter, not agreement.** Leases, ANTI_CHURN counters, the task queue and the budget
  ledger live in the store (futures plan build order 1-5: ledgers, counters, budget with reservations, effect
  journal, leases + fencing). Without them 1000 robots re-try the same bug 1000 times.
- **One committer per tree; one cmd_runner per worktree.** Many trees → a merge queue in front of
  `Local_Development`, each merge gated by its oracle.
- **Host capacity.** `dist\bin\opencode.exe` is 303 MB on disk; RSS per robot is unmeasured — hundreds of
  robots means several hosts, and the fleet then needs the scheduler (S4) on each. First number (2026-10-02,
  Get-Process): a headless `run` booting its OWN server = 882 MB, the owner's TUI = 691 MB — the per-robot cost of
  «every process is a server».
- **One addressable host per worktree = the fleet's address space** (owner, 2026-10-02: «любой из наших роботов
  сможет работать с другими worktrees если там запущен сервер, ты тоже сможешь подхватить запущенный сервер для
  оркестрации»). Built by the TUI delegate's plan `plans/2026-10-02_one-server-per-worktree.md` (branch
  `tui-live-sync`): every host records port + nonce + per-start token in its worktree's store. Discovery needs NO
  global registry: `git worktree list` names the trees, each tree's record names its live host. Consequences for
  this plan: a robot is a thin attached client, not a server (RSS: measured by that plan's acceptance); Claude
  orchestrates by subscribing to each host's `/event` instead of launching processes or polling the DB (retires
  `wait_done.py` and its race); the owner's TUI on any tree shows the robot's work live. Not yet built — a
  cross-worktree client probe (A reads B's record, drives B's host, B's TUI shows it) is the stage that proves it.
- **Seat terms.** Whether Team seats may drive automated verification at this volume, or whether that is the
  API / Agent SDK route, is the owner's check against Anthropic's terms — unverified here.

## Smoke Tests

- S1 smoke: the cmd_runner job for the TUI starts, `/automode` is accepted via the inbox (render read back), and
  the chosen plan's box state changes on disk. Prediction to be written before the run.
- Skill smoke: one tiny task dispatched and verified by its oracle; a provider call costs money — owner picks the
  task and model first.

## Deferred assessment inputs (owner: «пусть робот доделает работу, а потом проведем всестороннюю оценку»)

MASTER_PLAN.md review, 2026-09-30 (verified on disk):
1. level-0 goal has no SV/md5 → `parent-goal-md5` links have no root; YAML SVs carry keywords+dominant only (no
   md5/prev/parent) → the mandated «link» SV is unrepresentable; the file has no own SV.
2. `SVMRecord` (`session/svm.ts:25` = {task, plan, sv, etaTurns, state, oracle}) lacks parent_turn_id,
   goal_hierarchy and any evidence/stamp field → `state: verified` cannot carry its run id (violates the file's own
   rule #1); S4 renders from it.
3. `plans/emergency/` (2 plans), postponed (2), futures (5), to_be_confirmed (17) are absent — collectPlans is flat.
4. S4 oracle «two renders byte-identical» passes a deterministic wrong render — add counts == planstatus, every
   plan in plans/** exactly once, missing SV prints MISSING.
5. `open` field inconsistent (list / number / absent for 8 of 14).
6. R1 `blocked` without a lift signal (its note describes a next step → really `doing`).
7. kernel-candidate plan SV stale (describes «pipeline», not F6–F8).
8. dangling «C3 above»; header 09-29 vs counts 09-30; misplaced bash-tool plan has no entry.
Plus the reframing to weigh then: ADID 12.2 `scripts` as the task's replayable READ-only evidence (smokes,
diagnostics, reproducers, qualification fixtures), and ADM descriptors as its verifiable mutation half
(AGENTS.md § no-script rule; `experiments/2026-09-30_adm-binary-smoke/`; ADM fixes running in the ADID_Python
session `task_b22a12ec`).
