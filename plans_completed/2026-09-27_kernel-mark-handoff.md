# Handoff 2026-09-27 — the mark (`✓`/`✗`) is a confidence INDICATOR, and one line contradicts itself

<!-- intention: a session dedicated to the kernel owns the mark question, because the kernel has its own
     pipeline and its own constitution and SELF_MODIFY outside that harness is unsafe. This file hands
     over the MEASUREMENT and the one-line defect, and names the collision a concurrent session must
     resolve rather than discover. -->

## State: DISCHARGED 2026-09-27 06:15Z — both items closed, one of them found a real defect

- [x] **The kernel-side fix.** The dedicated session changed the polarity instead of deleting the
      clause: `reasoning_prompt.txt:405` now reads «Unmarked, a claim is **Guess** (@INFOMARK) **but**
      reads as CONFIRMED to the next reader: **that gap is the defect**». Both facts survive and the
      ORDER decides, so silence is the bottom rung and the misreading is named as the thing to
      remove. Owner installed it: «все — исправили», then rebuilt. **Verified here by reading the
      installed file AND this window's own prefix — both sides carry the new text.**
- [x] **The collision this file predicted, and it was worse than predicted.** Not «both carriers hold
      the phrase» — the runtime line held a phrase whose MEANING had changed underneath it, so the
      same words read as an instruction on one side and a diagnosis on the other. The resolution was
      not a wording: the runtime line no longer restates the prefix at all
      (`packages/opencode/src/session/compaction.ts`, commit `66511c3965`'s successor), and a NEGATIVE
      assertion in `test/session/tail-note.test.ts` pins that it cannot come back. One carrier per fact.

**While resolving it, a defect this handoff did not predict — see the plan's own log.** Fixing the
suite for this collision exposed that `9e6f6d06` had replaced the summary gap LIST with a COUNT while
the row render walks only the `## ` headings the body HAS, so a section absent as a heading was named
nowhere: the note read `sections missing per row: 3` and no reader could learn which three. Counted
without naming is a silent zero one layer up. Fixed in the product, `66511c3965`.

**Not part of this handoff, still open, named so it is not lost with the file:** T4b in
`plans/2026-09-27_mechanical-s-cadence.md`, and the three boxes in
`plans/2026-09-26_fold-carrier-integrity.md`.

---

**A concurrent session is editing the kernel RIGHT NOW.** `git status` at 05:26 showed six files
modified that are NOT mine: `prompt_kernel/addons.py`, `addons_claude.py`, `addons_codex.py`,
`packages/opencode/src/session/prompt/reasoning_prompt.txt` (the INSTALLED artifact),
`.claude/reasoning_kernel.md`, `docs/kernel-quality-doctrine.md`. **I did not touch any of them and
they must not be reverted.** Also untracked: `file-7d23c4f2588f3dde` in the repo root — not mine,
not deleted, reported not cleaned.

**RESOLVED 06:15Z:** that session committed its six files and they are no longer modified. The stray
`file-7d23c4f2588f3dde` is gone from `git status` as well — deleted or committed by its owner, not by
me.

## The kernel is NOT broken. The defect is one sentence that says two things.

`prompt_kernel/addons.py:188-189` renders verbatim to `reasoning_prompt.txt:405`:

> An unmarked claim **reads as CONFIRMED** to the next reader: without a status it **is Guess**
> (@INFOMARK) and its prose cannot be told from a verified one.

Same sentence, two opposite defaults: the first half says silence reads as the TOP rung, the second
says silence IS the BOTTOM rung. **The first half wins, because a reader meets it first and the
second looks like a refinement.** That is the mechanism behind the observed «everything marked as
exact» — and it is in the text that ships every turn, not in the model.

**The one-line change:** drop «An unmarked claim reads as CONFIRMED to the next reader», keep «without
a status it is Guess (@INFOMARK)». Silence then reads as the bottom, which is the only safe default.
No new rule, no second instrument. Pipeline: `addons.py` -> `pytest prompt_kernel/tests/ -q` ->
`python -m prompt_kernel --install` -> rebuild.

**Note the variant already says it better:** `addons_claude.py:147` carries «A confidence indicator,
not epistemology» in place of the contradiction, and the runtime `reasoning_prompt.txt:406` carries
it as a FOLLOW-UP clause. So the two variants already differ on this line, and one of them is the
fixed text.

## The mark must NOT become the ladder — the kernel says so itself

`reasoning_prompt.txt:406`: «…a **confidence indicator, not epistemology**.» The epistemology is
`@INFOMARK` / `@INFORMATION_STATUS`, with `EVIDENCE_ORDER` and `GUESS_DECIDES_NOTHING` as separate
rules. `prompt_kernel/migration.py:48` records that `INFOMARK_SEP` was merged into
`INFORMATION_STATUS` with the rationale «Status separation is part of the canonical
information-status rule» — the separation is a decision, not an accident.

**A session (mine) spent an evening trying to make the mark carry the ladder.** It should not. The
vector `v1..v5` of ADID 12.2/14.0/15.3 is live *in the 15.3 canon* (`docs/ADID_Framework_15_3.md:63-67`
thresholds, `:81` normalized sum, `:85-87` the function, `:99-101` the promotion criteria,
`:129-131` reverse search may use ONLY Exact + Inferred), but `docs/ADID_Framework_15_3.md:12-20`
states that the kernel is a separate self-contained canon and that **15.3's semantic-vector narrative
does not map onto transformer attention**. Two canons; do not merge them. `docs/two-canon-protocol.md`
owns that.

## Measured, on this session, 2026-09-27

| what | number |
|---|---|
| replies with no mark, before the counter named the form | 121 of 125 (`marks: NONE`) |
| marks per reply, after | 2, then 6, then 9, then **13** |
| replies with no mark, across the window | 80 of 88 |
| `sv:` counter over the same window | 2 misses, then 0 — same line, same model, same turn |

**Two regimes, never a middle: absent, or excessive.** That is a diagnosis from data, not taste, and
it says the fix is not «add more marks» but «one mark per closed claim, not per intermediate word».
The owner's own example is the tic: 22 «Хм:» and 47 marks in 2 500 characters — one mark every 53
characters, each attached to the NEXT line rather than to a fact.

## What I changed, and the collision it creates

`packages/opencode/src/session/compaction.ts` (committed, `+8 −1`): the `marks:` zero branch now
prints the **required form** instead of only the consequence, because `sv:` does exactly that in the
adjacent branch and the misses went 2 -> 0. Typecheck exit 0; `test/session/compaction.test.ts` 89
pass / 0 fail (run `20260927T043440Z_0087608b`, which reported **exit -1 with 89 green** — the known
process flake, so read the log, not the code).

**COLLISION TO RESOLVE, not to inherit:** that runtime line still ends with «Unmarked claims read as
CONFIRMED» — the very phrase the kernel fix removes. I deliberately did NOT reword it: the wording
belongs to the kernel session, and editing it from here would be a second opinion racing a live edit.
**Either the addon fix reaches this line too, or the phrase is dropped here as well. Leaving both is
the worst outcome, because then the contradiction exists in two carriers and fixing one hides it.**

## The class that produced this whole evening, in one line

**A quote from a block whose second half I did not read.** I cited `reasoning_prompt.txt` all night
— line 405 — and the answer was line 406, three lines below, in the same block I had open. Nine
commits were built around a rule I had half-read. Before proposing any change to a system, read the
canonical source to its END: `docs/ADID_Framework_15_3.md`, `docs/two-canon-protocol.md`,
`prompt_kernel/addons.py` — all three were in this worktree the whole time.

## Not done, not claimed

- `plans/2026-09-27_mechanical-s-cadence.md` T4b (threshold-crossing regression) — open, and the
  one place where the existing `prompt.test.ts:874` does NOT reach the capture block.
- The kernel fix itself — **not attempted here**, by design: SELF_MODIFY needs the kernel pipeline
  and this session has no authority over it while another session is editing the same files.
- `turn`/`sv` on the stored diffs — committed (`4db3a9533a`, `b66db93670`, `66c47db10c`) but **not
  live**: no row carries them until a rebuild, and the rows already written cannot gain them, the
  attribution having died at merge time.
