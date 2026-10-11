# Reasoning mode as an escape hatch: self-diagnosis of inference failures

Why this page exists: the owner asked for it (2026-10-11) after recalling a
reasoning-mode session that squashed an inference bug — «в прошлом я видел как ты
его использовал на практике чтобы давить inference баги — шедеврально» — and named
the property that makes it work: «в обычных условиях у модели вообще нету шансов из
этого состояния выбраться». This page records the mechanism, the measured case, the
rules the chamber produced, and the levers that actually escape.

Companion pages: [reasoning-mode.md](reasoning-mode.md) (what the mode is),
[mode-transitions.md](mode-transitions.md) (how the transition is gated).

## 1. The trap: escape cannot come from inside

Primary source, verified 2026-10-11 (arXiv:2512.04419, *Solving LLM Repetition
Problem in Production* — three repetition patterns, three mitigations):

- **BadCase 3** — "model generates valid PlantUML code initially but then
  **repeatedly generates closing statements**" (their §pattern 3). Our observed form
  was the same shape with our own closers: `</parameter></invoke>` runs in the output.
- Mechanism (§Markov analysis): (1) **Context Repetition Leading to Probability
  Enhancement** — "when the context contains repeated patterns, the model tends to
  increase the probability of tokens that appeared previously, learning a shortcut to
  copy from recent history"; (2) **Self-Reinforcement Effect** — "the probability of
  repetition increases monotonically with the number of historical repetitions,
  creating a positive feedback loop".
- The consequence, in their words: "once the model enters a repetitive state, **the
  expected escape time is infinite**, explaining why greedy decoding cannot break out
  of repetition loops" — the loop ends only when "external constraints (such as
  `max_tokens`) force termination".

So the owner's formulation is not a metaphor: **inside the state, the only generator
available is the one that is failing, and every extra token raises the repetition
probability.** The paper's own cures are decoder- or training-level — Beam Search with
`early_stopping=True`, `presence_penalty` (BadCase-1 only), DPO fine-tuning (15–18 GPU
hours per BadCase) — **none of them reachable by a running agent**. The escape must
therefore be an *external* device, and everything below is about those devices.

## 2. What reasoning mode contributes

Reasoning mode is a primary identity (`reasoning_mode`) with no execution surface:
`checkstate`, `memory`, and its own `reasoningexit` are the only authorized tools
(`agent/agent.ts:204-216`); the transition is silent and deliberately NOT
permission-configurable (`docs/mode-transitions.md`). As an escape device it does four
things no prompt can:

1. **It cuts the poisoned material away.** No tools ⇒ no 300 KB dumps, no repeated
   tool schemas, no monotone call grammar. The repetition source (metric B below) is
   removed by construction rather than resisted.
2. **It is a boundary of the context, not a resolution.** The switch starts a new
   identity with a mode tail; the damaged window is not argued with.
3. **It has exactly one output channel that survives it**: permanent memory
   (`.opencode/data/memory/reasoning.md`), which rides every message of the session —
   so every entry is a standing context tax (M-0).
4. **It cannot act, which is the point**: findings are *decisions plus falsifiers*,
   and acting waits for `reasoningexit` (the 2026-09-13 record states this explicitly:
   "требует выхода из reasoning mode").

Kernel rule that authorizes the entry: `INTENTION_RESET` / `SELF_DIVERGENCE`
(`prompt_kernel/source.py:713`) — entered by the user's call or by the agent itself
"on repeat failure (STALL per @LOOP_PROGRESS)"; the product is stated there: **"durable
falsifier, not apology."**

## 3. The case: 2026-09-13, session `ses_f6b2fce9` (project `D:\zPython\_1C_Project`)

The event: UI-automation work pulled raw UIA dumps into the context (298–300 KB per
call; 12 tool-output files > 200 KB); the output then degenerated into a run of closing
tokens — a generation that aborts mid-word, so the record itself is truncated
(`msg_0951f2643001qLWDFZpzzdESz5`: `step-start`, `reasoning (5606 B)`, `text="Полная
карта ви"` cut mid-word, **no `step-finish`**).

What the chamber produced is a pre-registered measurement, frozen before the run
(`experiments/selfdiag/BASELINE.md`, `metrics.py`; commit `eb21ff5` in that repo):

| metric | definition | result |
|---|---|---|
| **R** | runs of ≥3 identical closing tokens in persisted parts | **0 over 7413 parts — FAILED** |
| **R'** | incomplete-message rate (`step-start` without `step-finish`) | 38/1652 = **2.30%**; substantive (reasoning > 100 B) **0.36%** |
| **R''** | consecutive failing-tool-call streaks ≥ 4 | 2/1652 = **0.12%** (one `write: error ×6` in a single message) |
| **B** | tool-output bytes | **4.32 MB**, 12 files > 200 KB (largest 300 246 B, all UIA dumps); session parts 20.6 MB |
| **E** | failures per call | multiedit **10.31%**, bash 10.08%, edit **4.20%**, write **4.12%**, all other **4.06%** |

The three findings that matter more than the numbers:

- **R failed informatively, and was left FAILED.** The abort never persists the
  pattern the metric looks for, so R was "blind by construction, not merely
  insensitive". It was **not retuned** — retuning after seeing the data is how a
  metric stops being a metric.
- **The loop lives in tool-call space, not token space** (R''). A token-pattern metric
  found nothing; the streaks are in *calls*.
- **A denominator control refuted our own claim.** "Mutation payloads are the fragile
  zone" was wrong as stated: `edit` (4.20%) and `write` (4.12%) sit at the baseline;
  the whole effect is `multiedit` (10.31%) — *one call carrying many composed edits is
  the fragile unit*.

The chamber also produced the rules (all decision-shaped, each with a falsifier):

- **M-0 — memory is a context budget.** Every entry rides every message: write
  `trigger → decision → falsifier → status`; no falsifier ⇒ delete the entry.
- **M-1 — decisions, not prohibitions.** A prohibition activates the forbidden thing
  in the RL policy and is executed by the same mode that is broken; «сначала сочини,
  потом транскрибируй» works where «не повторяйся» does not.
- **M-2 — semantics first, then md5.** Rebuild the causal link in fresh words
  (Keywords + Semantic dominant); only then inject entropy (an md5 token that cannot
  be predicted). **Trigger, not schedule**: mechanically inserting md5 makes it a new
  rhythm and destroys the effect. Falsifier: 3+ identical closing tokens in a row.
- **M-3 — compose, then transcribe.** Write the payload (and the Digital Intention
  before it) fully in the message text; the tool call is a mechanical transcription.
  Composition and transcription are separated in TIME, not by effort.
- **M-4 — args are payload, not prose.** The argument shape is decided before the
  call; evidence: `SchemaError` fired on a call that was emitted before it was composed.
- **RC-3 — stop, do not patch.** ≥3 identical closers means the answer is already
  damaged; "не дописывать, не «дочинивать»" — the repair attempt is more repetition.

## 4. The levers that actually escape (what to do, in order)

1. **Prevent context repetition at the source** — the only lever the agent controls
   directly: project wide output *before* calling (`query`, `offset`/`limit`,
   `include_screenshot:false`, `max_elements`). This is metric B's handle, and B is
   the driver of the mechanism.
2. **Cut the context externally when degeneration starts**: a fold/compaction boundary
   or a fresh identity (reasoning mode) — do not continue in the same window.
3. **A host-side tripwire** — a countable runtime detector (streak of failing calls,
   identical closers) that stops the turn instead of hoping. This is a runtime/kernel
   change (the 2026-09-13 record names it as the one thing the chamber could not do:
   "Durable falsifier на уровне рантайма … в reasoning mode недоступно"), and the
   evidence for it is `R''` — the loop is in tool-call space, where the host can see it.
4. **A persistent carrier** so the lesson survives the reset: memory entries in the
   four-field form, plus (for project-level lessons) `_progress_log.md` / plan boxes.
5. **Operationally, at the second consecutive failure of the same tool, change
   approach** — the streak data says calls 3–6 add nothing.

## 5. How to run the chamber

- **Enter** on a repeat failure rather than a statistical miss (kernel
  `INTENTION_RESET`), by the user's call or the agent's own.
- **Write memory in the four-field form**; a prose narrative is a tax with no falsifier.
- **Freeze the metric BEFORE measuring**, make it countable, and pre-name what a
  failure looks like; a metric may legitimately FAIL, and then it stays on the record
  as FAILED (R did).
- **One independent review allowed to attack** — an isolated model call is an
  independent *Inferred*, it removes self-grading and never yields Exact.
- **Exit to execute**: nothing acts inside the chamber; the findings exist to be run
  outside, and the proof is a re-measurement on NEW sessions (still open here: whether
  the measures move `R''`).

## 6. Epistemics of this page

- **Exact**: artifact paths and their content (read 2026-10-11); the numbers above;
  the two memory revisions of 2026-09-13; the commit `eb21ff5` exists; the paper's
  title, abstract and the quoted mechanism/BadCase-3 lines (fetched).
- **Inferred**: the causal chain *as applied here* — bloated repetitive context raises
  the copy-shortcut probability, which surfaces as streaks; consistent with the
  primary source, not proven in our setting.
- **Guess**: the exact sampler/RL mechanism (our logits are unavailable).
- **Known gaps**: the raw generation stream is not logged, so a token-space loop that
  completes normally stays invisible; `R''` is countably sound for tool-level loops
  only.

## 7. Raw record (outside this repo, read-only)

`D:\zPython\_1C_Project\` —
`.opencode/data/memory/reasoning.md`, its revisions
`reasoning-2026-09-13T06-36-35-935Z.md` and `reasoning-2026-09-13T07-08-34-914Z.md`,
`experiments/selfdiag/BASELINE.md` + `metrics.py` + `metric_rprime.py` +
`metric_streak.py` + `error_rate.py` + `scan_r.py`, session `ses_f6b2fce9`, commit
`eb21ff5`. Primary source: arXiv:2512.04419 (verified 2026-10-11).
