<!-- intention: the ✓/✗ assertion marking is a written kernel norm with a machine counter and a memory line, yet it reproduces only where the whole system prefix is fresh — in another session or another harness the marking simply does not appear -> the marking is reproducible anywhere, with a MEASURED share of marked assertions as the acceptance, so it stops being one session's habit -->

# Assertion marking — make it reproducible instead of a habit

**Status:** ACTIVE

Written 2026-09-24 on the owner's request, as a state-carrier report: «мне нужен твой отчет как задача в планы, чтобы добиться такой
маркировки сообщений… мне нужны твои соображения на этот счет как носителя состояния. Все что придет в голову — пиши.»

## What already exists (measured, not assumed)

- **The norm** — `prompt_kernel/addons.py:213` (G7 addon `ASSERTION_STATUS`), and in the same shape in
  `addons_claude.py:173`, `addons_codex.py:167`, in all three renders (`dist/`, `dist_claude/`,
  `dist_codex/`) and in `.claude/reasoning_kernel.md:385`. It came from the owner's own ruling recorded at
  `source.py:436`: «надо ввести стандартом в кернел для всех типов документации которую пишет ИИ».
- **The text**: «every assertion you write — code comments, docs, plans, commits, memory, reports, replies,
  working notes — carries its status: CONFIRMED (✓, naming the instrument) or REFUTED (✗, naming what
  contradicts it). An unmarked claim reads as CONFIRMED to the next reader, so without a status it is
  Guess (@INFOMARK).»
- **The machine counter** — `<compaction-status>` prints `marks: N ✓ · M ✗ in the last reply · K/window
  replies with none`. This is a LOOP: the model sees its own score each turn.
- **Nothing in the host-local `AGENTS.md`** — measured 2026-09-24: `grep -e ASSERTION_STATUS -e CONFIRMED`
  over the root `AGENTS.md` returns NO matches. That file is what a harness reading only its own rules sees.

## Why it does not reproduce — four causes, ordered by likelihood

1. **The checkpoint freezes the prefix.** A session opened BEFORE the norm was installed keeps the old
   system prefix («Path system frozen until compact — AGENTS.md/skills/rules edits mid-session do not
   rebuild system prefix»). Until that session compacts, the rule is not in it, however fresh the tree is.
2. **The variant receivers are installed BY HAND.** The kernel README says it outright: «Re-run
   `--claude --install` after any change to `source.py` or `addons_claude.py` to keep it in sync —
   **nothing does this automatically yet**». A stale `.claude/reasoning_kernel.md` (or `$CODEX_HOME/AGENTS.md`)
   is a receiver without the norm.
3. **It is a STYLE norm, so the model decides.** A strong model follows it, a weak one silently drops it.
   That is a property to MEASURE, not a bug to fix.
4. **A harness that reads only its own `AGENTS.md` never sees it** — see the measured absence above.

## My considerations as a state carrier

- **The marking inverts a default, and that is its whole value.** «An unmarked claim reads as CONFIRMED» —
  so silence is not neutral, silence is a claim of confirmation, i.e. the DEFAULT state of prose is a lie
  that flatters itself. Marking makes the default honest instead: unmarked = Guess. This is the single
  reason the norm earns its cost, and it belongs in the plan's rationale, not only in the addon.
- **✓/✗ is a falsifier channel, not decoration.** ✓ must NAME the instrument (a run id, a file read back,
  an exit code) and ✗ must name what contradicts it. A mark with no instrument is a smiley: it raises the
  counter and lowers the information. So the pair «mark + instrument» is the unit; the mark alone is not.
- **Carriers, weakest to strongest.** (a) a rule in the prompt — weakest, it competes with everything else;
  (b) an EXAMPLE next to the rule — much stronger, because a model imitates a shape faster than it obeys a
  description; (c) a NUMBER the model sees about itself (the `marks:` counter) — strongest, because it
  needs no willpower: a model that sees «K/… replies with none» corrects itself; (d) the owner's remark in
  the middle of work — the strongest of all, but it does not scale and cannot be the plan.
- **«Every assertion» overloads prose.** Reading my own replies, the ✓/✗ density is high enough that the
  marks start competing with the meaning. The scope that pays for itself: assertions of FACT (what is,
  what was proven, what was refuted) — not every subordinate clause. Narrowing the scope is the first
  decision, and it is the owner's to make, because it changes what the norm means.
- **A counter can be gamed, a counter with an instrument cannot.** Marks are cheap to emit; ✓ followed by
  the name of an instrument (`run 20260922T171027Z_3688c01b`, `Code.test.ts 70 pass`) is not, because the
  named thing can be checked. If the share of marked assertions ever becomes an acceptance, it must be the
  share of marked assertions CARRYING AN INSTRUMENT.
- **Reproducibility is measurability.** «It works in one session» is an anecdote. The honest acceptance for
  this plan is a fixed prompt set run against several models with a reported marked-share table — the same
  shape as any other oracle in this repo. Without that table the plan closes on vibes.
- **The variants are the real gap.** opencode has the counter loop; Claude and Codex have the norm TEXT
  and no feedback signal, and their receivers are hand-installed. Fixing the receivers without giving them
  a signal would leave the same failure one layer up.

## Tasks

- [ ] **T1** — decide the SCOPE with the owner: «every assertion» vs «assertions of fact», and whether the
  mark must carry an instrument name to count. Without this the rest is undecidable.
- [ ] **T2** — put the norm (and its scope) into the host-local `AGENTS.md`, which today carries none of it
  (measured). A harness that reads only that file must still learn the convention.
- [ ] **T3** — add a SHORT marked example beside the rule in the addon: three lines of prose with one ✓ and
  one ✗ that names its instrument. Rationale above: examples beat descriptions.
- [ ] **T4** — make the variant receivers refresh from the build instead of by hand
  (`--claude --install`, `--codex --install`), or name the step loudly where a stale receiver would be
  visible; today «nothing does this automatically yet» is written in the README and nowhere enforced.
- [ ] **T5** — MEASURE reproduction: a fixed prompt set × several models, reporting the marked share and the
  instrument-carrying share. This table, not an impression, is the acceptance for the whole plan.
- [ ] **T6** — decide the variants' feedback: opencode prints `marks:` in `<compaction-status>`; Claude and
  Codex have no equivalent. Either give them one or record that they are normed but unmeasured.

## Risks

<!-- severity: critical -->
- **Marking without instruments.** The counter rewards marks; the value is in the instrument. If T5's
  acceptance is written as «share of marks» instead of «share of marks carrying an instrument», the plan
  will optimise the wrong quantity and call it success.

## Smoke Tests

- `python -m pytest prompt_kernel/tests/ -q` — must stay green (it guards the addon text and the budget).
- `grep -c ASSERTION_STATUS` over the three addons and the three dist renders — expected 6; a lower number
  means a variant lost the norm.
- After ANY addon edit: `python -m prompt_kernel --install`, then re-render Claude and Codex and probe the
  installed receivers for the sentence (a receiver is not updated until it is read back).
- Measurement run for T5: fixed prompt set × models → marked-share and instrument-share table, with the run
  ids recorded beside the numbers.

## Not in scope

- Rebuilding `bin/opencode.exe` (owner's act, explicitly not requested for this session).
- Changing test suites or writing new instruments for this feature — the request is a written plan.
