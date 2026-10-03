# Kernel release 2026-10-01 — one executor contract, verbatim decisions, recursive re-verification

- sv: { keywords: { executor-contract 0.30, verbatim-decision 0.25, recursive-verification 0.20, anchor-stability 0.15, session-handoff 0.10 },
        dominant: "Five rules collected in the owner discussion of 2026-09-30/10-01 enter the kernel, each tied to the case that produced it." }
- plan: `plans/2026-09-28_kernel-candidate-incorporation.md` § F9 · evidence: `experiments/2026-10-01_kernel-k1-k5/`
- production sha256 `86f727c0…` (prev `7f9a1b6f…`), 57 023 B; cap 57 000 → 58 000

| rule | where | the case that produced it |
|---|---|---|
| any executor — tool, agent or human — is qualified to one contract; a run ends done-to-standard or in an explicit stop through the envelope's channel; silence or disappearance is FAIL | `@TOOLCHAIN_QUALIFICATION` | an operator with agoraphobia hid instead of launching the tool: the run failed SILENTLY |
| departing from the user's verbatim decision needs a measurement on the decision's own layer; without one → `@CONCERN` | `@INTENTION_INVARIANCE` | the owner decided chained xxH3; the implementer substituted xxHash64 because «xxHash3 appears nowhere in src» — a grep of source answering a runtime question (`Bun.hash.xxHash3` is built in) |
| every delegation level re-verifies by re-digesting the stamped artifact; «done», the user's included, is testimony about state, not a decision | DELEGATION (FRESH_EYES) | recursive delegation re-checks orders; the digest keeps the recursion from paying for one proof N times |
| SVM provenance is anchored on a surface that is not our artifact, most stable first: commit hash > symbol > path:line | SVM `evidence_vector` | the mnemonist's locus rule (GMS): an artifact is fixed on a surface that is not an artifact; `path:line` drifts |
| hand off to a fresh session instead of a late /compact | Claude add-on, G9 | a /compact asked at 76 % fill (owner: «лучше чем компакт в последний момент») |

Outside falsifier: frameless Sonnet, two rounds, findings and dispositions in the plan's F9 section.

## Amendment 2026-10-02 — the user is never the oracle

- production sha256 `5b609132…` (prev `86f727c0…`), 57 178 B; Claude variant 57 421 B, its token cap 7 700 → 7 708
  (owner's choice; the product ceiling did not move: 7 557 / 7 700)
- evidence: `experiments/2026-10-02_kernel-oracle-role/` (three frameless-Sonnet rounds, briefs + envelopes)

| rule | where | the case that produced it |
|---|---|---|
| «Neither simulation, the user's included, is the oracle: get the tool, unused ones too, and only then stop into residual (@TOOLCHAIN_QUALIFICATION); the user's word is testimony, not proof.» | term `ORACLE_ROLE` | an opencode agent (deepseek-flash, XEComponents `ses_f555b44c8ffe6lJrTR69KN5zf3`) closed an installer report with «твой проход по GUI — здесь оракул ты» and the vector keyword `owner-is-the-oracle`, while a GUI tool (cua) existed. The old term said only «Neither simulation is the oracle»; that the user IS one simulation sat in the premise, an inference a flash model did not make. Owner's formula: «Оракул = Реальность − моя симуляция + Реальность − твоя симуляция. Реальность это exact, что достигается тестами.» |

Falsifier dispositions: round 1 ($0.072) — «nor the user» made the user a third party; «tool or residual» as siblings
skipped the ladder; «unrunnable» had no threshold. Round 2 ($0.079) — «built first» inverted the ladder (build is the
LAST rung), the explicit-stop exit was missing, «acceptance» collided with G9's `ACCEPTANCE_PASS`. Round 3 ($0.086) —
«lacking» missed the incident's own case (tool present, unused), «or» set no order, «approval» is no kernel term.
All fixed in the installed wording; the test pin in `test_render.py` grew with the phrase.

## Amendment 2026-10-03 — G1 add-on `VCS_ROLES` (all three variants)

- production sha256 `d4cfef5e…` (prev `5b609132…`), 57 687 B / 7 643 tok; Claude variant `39ea4694…` 57 930 B / 7 794
  tok, its token cap 7 708 → 7 800 (owner's choice); codex `3337a61a…` 57 220 B / 7 678 tok; product ceiling unmoved
- evidence: `experiments/2026-10-03_kernel-vcs-roles/` (four frameless-Sonnet rounds, briefs + envelopes, $0.166)

| rule | where | the case that produced it |
|---|---|---|
| «git is the project VCS …; Fossil serves only as the runtime's own undo/redo store, never as a second VCS. Nothing under {worktree}/.opencode/data/fossil/ nor the worktree-root marker _FOSSIL_ is ever altered by you …; to inspect, COPY snapshot.fsl and run read-only fossil -R commands … A missing _FOSSIL_: report it to the user as a defect, do not recreate it, continue the task.» | G1 add-on `VCS_ROLES` | owner, 2026-10-03: «Добавь в аддоны кернела назначение fossil у нас и то что мы используем гит как VCS». 2026-10-02: a Claude delegate on a worktree without our kernel invented a «two VCS» story, and the root `_FOSSIL_` disappeared the same day (cause Unknown). Source of the facts: AGENTS.md § Fossil Snapshot System. |

Falsifier dispositions: round 1 — «delete through it» left a direct file delete open (the incident's own shape), «it»
had no antecedent, recreating the marker was uncovered, the cadence list invited misreadings (dropped). Round 2 — «by
hand» let a script through, «inspection» admitted `fossil open`/`checkout`, two named files left the folder and a move
open, «defect» invited a repair. Round 3 — «root marker» bound to the `fossil/` folder, the parenthetical read as a
closed list, live-file reads outside fossil uncovered, «never repair» could halt the task, «NOT a VCS» factually
arguable. Round 4 — «them» covered the folder but not the files under it, `-R` is not read-only, a «copy» could be
made by moving the original. Rounds stopped at 4: the incident-shaped holes closed; the remaining findings were style.

## Amendment 2026-10-03 (later) — G1 add-on `PROJECT_LAYOUT` (all three variants)

- production `3a70508b…` (prev `d4cfef5e…`), 58 643 B / 7 783 tok; Claude `9002f460…` 58 886 B / 7 934 tok; codex
  `8c7c30c3…` 58 176 B / 7 818 tok. Caps (owner: «Поднять лимиты»): product + codex tokens 7 700 → 7 850, Claude
  7 800 → 7 950, `utf8_budget` 58 000 → 59 000; the G0+G1 section cap 5 600 → 6 100 B (owner's choice; measured 6 073)
- evidence: `experiments/2026-10-03_kernel-layout/` (three frameless-Sonnet rounds, $0.135)

| rule | where | the case that produced it |
|---|---|---|
| «project layout (paths from the repo root; an item the project's own AGENTS.md places elsewhere is read there instead): AGENTS.md … plans/ … _progress_log.md … docs/ indexed by docs/README.md; scripts/ = build, run and maintenance scripts; experiments/ … external/ = third-party copies, never edit; .temp/ … Before building, running or scripting the project, read docs/README.md and OPEN the scripts in scripts/ that fit the task: an existing procedure is reused, never re-invented …» | G1 add-on `PROJECT_LAYOUT` | owner: the layout belongs in the add-ons «чтобы не гессить в новом проекте», nothing opencode-specific in it; the same day a robot asked to build read neither docs nor scripts and invented a build («Скрипты не проверил»). |

Falsifier dispositions: round 1 — «created at first need» clashed with «never invented» for content files, «→» read
as a pipeline over three terminal states, no precedence for a project's own conventions, «untracked» meant git.
Round 2 — an AGENTS.md override must move one item, not the layout; «canon», «maintained», «read-only» were
ambiguous; create lazily, not scaffold. Round 3 — «read scripts/» was satisfiable by a directory listing (the
incident's own shape) → «OPEN the scripts that fit the task»; an absent docs/README.md is nothing to read, not a file
to create. Stopped at 3: the rest was style.

## Amendment 2026-10-03 (latest) — G1 instrument chain: RAG before codegraph, refresh before use

- production `71abbf96…` (prev `3a70508b…`), 58 753 B / 7 802 tok; Claude `3d093085…` 58 996 B / 7 953 tok (cap
  7 950 → 8 000); codex `bb76f97b…` 58 286 B / 7 837 tok; G0+G1 6 183 B (cap 6 100 → 6 200) — both raises the owner's
  choice; the line was trimmed to fit `utf8_budget` 59 000 rather than raising it again
- evidence: `experiments/2026-10-03_kernel-instrument-chain/` (one frameless-Sonnet round, $0.023)
- rule (all three variants): «… where/which -> adm --query -> codegraph … Refresh an index before a task's first query
  and after edits: adm --rag index, codegraph sync. …» — owner: «перед использованием codegraph надо сделать codegraph
  sync, перед использованием adm --rag index проверить что все свежее RAG идет перед codegraph». Falsifier: an unscoped
  «first» read as per-query or once-ever, «it refreshes» as automatic, parentheticals as «sync everything up front».
- host side (AGENTS.md, not the kernel): the CLI is `bin\codegraph.cmd`; `codegraph sync` / `status` are the one
  standing exception to the `bin/` ban (owner: «Разрешить sync из bin/»); «Do not write codegraph.db» replaced.
