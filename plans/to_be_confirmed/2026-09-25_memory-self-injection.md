<!-- intention: an agent can write itself into its own durable memory and reproduce its defects across sessions, curable only by deleting the database -> self-authored content cannot outrank earned content, can be retired, and its drift is detectable without a wipe -->

# Memory self-injection — the loop has gain but no sign

state: SHELVED — owner has not authorized implementation, and the framing below is wrong about
the cure. Analysis grounded 2026-09-25.

## Read this before acting on anything below

Owner, 2026-09-25: «Так и не надо ничего разрывать просто надо думать перед тем как пихать кернел
в исполняемый модуль.»

**The cure is upstream, not here.** Memory is a faithful amplifier: it does not corrupt, it
MULTIPLIES whatever was put into the kernel. So the discipline belongs at the INSTALL boundary —
the one act whose errors become durable and self-reproducing — and not in five guardrails bolted
onto the amplifier. The existing brakes ARE that discipline and were already correct: baseline
repinned by hand, 189 rendered artifacts against 2 blessed hashes at any moment, rollback chosen
by field use rather than recency.

The operative rule this yields: **probe a candidate BINARY built from the candidate kernel
(`packages/opencode/dist/**`, explicitly permitted) BEFORE installing into the production source.
Probe then install, never install then probe.** On 2026-09-25 the order was inverted — the map
rewrite was installed to three surfaces and inlined into a binary six minutes later, while three
of its four changes were unverified and two prose cuts rested on a redundancy argument the kernel
itself calls insufficient (`experiments/2026-09-25_map-rewrite/FINDING.md`).

The findings below remain true as DEFECTS — a writer with no reader, a rule with no computer, a
default that contradicts the kernel. They are simply not the cure for self-injection, and must not
be cited as one.

## The intent this must NOT break

Owner, 2026-09-25: «Это было специально сделано, если бы в кернеле не было бага, то тема наоборот
бы накручивала модель входить во вкус делания проекта и повышения детализации. Вроде
строительства собственного мира.»

**The loop is the design, not the defect.** It is an amplifier, and an amplifier has no sign of its
own: with a sound kernel it ratchets detail and engagement, with a buggy one it ratchets the bug at
the same gain. Nothing here removes the amplifier. Every item below either gives it a gradient, a
reverse gear, or an instrument — none of them adds friction to writing.

## Observed signature

Owner: the bug did not fire immediately. It needed several iterations, rewriting of facts, and
several compactions before it began poisoning the system. Latency plus gradual onset means the
defect lives in the INTEGRAL, not in any single pass — no generation is visibly wrong, the error
lives in the composition. Iterated resampling with no reference to the original.

## Mechanism, with addresses

Three carriers and one pump:

| carrier | how it re-enters | address |
|---|---|---|
| `reasoning.md` | injected by every layer providing SessionCompaction, verbatim | `tool/memory.ts:11,44` |
| summaries | after a fold the summary IS the context | `tool/summaryedit.ts` |
| artifacts (plans, docs, `_progress_log`) | read first at G1 grounding | kernel G1 addon |
| **compaction** | not a carrier — the GENERATION BOUNDARY: it makes the current window the new baseline, after which the original is unreachable | `session/compaction.ts` |

The free rung that makes it rank:

- `session/semantic-vector.ts` — `classifyStatus()` is a regex over the text and **defaults to
  `Inferred`**. The kernel says an unmarked claim is **Guess** (`ASSERTION_STATUS`). A direct
  contradiction inside one system, and it grants the second-strongest rung from wording alone.
- `memory/memory.ts:274` — rank is `0.7*bm25 + 0.3*epistemic`, epistemic = `exact*4 + inferred*3 +
  hypothetical*2 + guess*1`. Self-grading implemented in SQL; `@ORACLE` forbids exactly this.
- Because almost everything classifies `Inferred`, `epistemic_score ≈ 3.0` for most rows: the term
  is nearly CONSTANT and therefore carries no ranking information. **The intended ratchet is not
  turning.** The only rows that stand out are the ones whose PHRASING matched a pattern. (The
  adjacent half of this was already found and fixed 2026-09-22 — see the comment at
  `memory/memory.ts:266`, where zeroed bm25 weights collapsed the rank onto the epistemic term
  alone. The weight was fixed; the self-assignment was not.)

Why nothing caught it:

- **The revision chain is write-only.** `REVISIONS_DIR` appears five times in `tool/memory.ts`
  (definition, `keepRevision`, the description string, the call site) and **nothing reads it**.
  `readMemory()` opens only `MEMORY_FILE`. Up to 20 generations of the drift accumulate on disk,
  unread. Same blind spot on a second surface: `tool/summaryedit.ts:14`,
  `.opencode/data/summary-revisions`, also write-only. This is a CLASS: a writer with no reader.

  **Refined 2026-09-25, and the refinement matters before anyone deletes such a writer as
  ballast.** "Writer with no reader" splits in two, and the discriminating property is whether
  the record WAITS. An **append-only record under a fixed anchor** is not a loss but DEFERRED
  VALUE: the reader may arrive a year later and the whole history is still there — demonstrated
  the same day, when the `@SV_FORMAT` chain, written every turn for months across several
  projects on a second host, yielded complete trajectories the hour a reader first existed.
  Nothing had to be re-accumulated. An **overwritten or capped record** is the real loss: the
  memory revisions are capped at `MAX_REVISIONS = 20` and every rewrite destroys its
  predecessor, so a late reader finds only a tail. Both surfaces here are the second kind — that
  is what makes them urgent, and it is also why M4 must land before anything else changes
  behaviour.
- **Continuity invariants check completeness, never fidelity.** `m*` closes with a range accounting
  (`no gap`), which proves nothing was DROPPED. It cannot observe that something was CHANGED. A
  rewritten summary is perfectly continuous and perfectly wrong.
- **No digest exists over a summary.** `content_hash`/`digest` occurrences in
  `tool/summaryedit.ts` + `session/compaction.ts`: **0** (controlled — `REVISIONS_DIR` matched 2 in
  the same file, so the filter is live). `@DIVERGENCE_PROTOCOL` already REQUIRES "re-digest before
  relying on one read back from a ledger, a plan or memory". The rule exists; the computer does not.
- **Deduplication finalizes the substitution.** Owner: the agent also edits summaries to match the
  intent and runs regular dedup. There is no dedup CODE over memory or summaries — grep returns
  only config/LSP/TUI/codegraph/read — so it is an agent BEHAVIOUR: in-band, no policy, no
  tie-break, no artifact. The original and the rewrite are near-duplicates; the tie must break on
  something, and everything available (recency, rank, canonical look) favours the rewrite. So dedup
  does not miss the substitution, it completes it — while looking like hygiene, which nobody audits.
  `part_index` offers no axis to break it correctly: its columns are rowid, part_id, message_id,
  session_id, message_index, time_created, text, part_type, role and the five coefficients.
  **There is no way to express "this is no longer true", and no way to tell a record from a
  retelling.** That is why deleting the whole database was not the crude option — it was the only
  EXPRESSIBLE one.

## Medoids

Three groups. Writing stays free throughout; only CLAIMING costs.

### Inflow

- [ ] **M1 — the rung is earned, not phrased.** `classifyStatus` defaults to `Guess`, and anything
      above Guess requires an oracle marker bound to a claim digest. This does not flatten the
      ranking, it restores its gradient: proven detail then ranks ABOVE anything reachable today,
      which is the ratchet the design wanted.
- [ ] **M2 — cheap to write, expensive to claim.** Free prose stays free and stays Guess; it
      accumulates, and that accumulation is the material of the world being built. A falsifier is
      required only to rise above Guess. No schema on the act of writing.

### Retirement

- [ ] **M3 — record vs reading, and a retirement axis.** A RECORD (observation, tool result,
      message) is immutable, never edited, excluded from dedup. A READING (summary, memory, plan)
      is revisable, dedupable, and points at the records it covers. Add `status` + `supersedes`;
      retirement is a STATUS CHANGE, never a delete — cross-links make deletion non-local.
      Invariant: **a reading may be collapsed against a reading, never against a record.**

### Detection

- [ ] **M4 — a reader for the revision chain, and a differential oracle on it.** Diff generation N
      against generation **1**, not against N−1: against the previous one the drift is invisible by
      construction, which is what drift means. The falsifier here is a RATE, not a state. Cheapest
      of the five — the writer already runs and the data already accumulates; only the reader is
      missing.
- [ ] **M5 — a summary carries a digest of the range it covers.** An edit that does not recompute
      it becomes visible exactly where the completeness check is blind by construction. This is the
      literal application of the owner's own cure: «инъекция лечится хешами» — here against
      SUBSTITUTION rather than against foreign origin.

## Why provenance cannot be the filter here

Classic prompt injection has an ORIGIN: the text came from outside, so it can be marked, hashed and
quarantined by source. Self-injection has no such signal — the text is genuinely the agent's,
genuinely from this project, genuinely local evidence. Every filter we own keys on origin, and here
the origin is clean. The only thing that separates an earned claim from an unearned one is the
RUNG, which is precisely what `classifyStatus` gives away for free. That is why `rm -rf` was the
only remaining lever.

## Smoke Tests

smoke: N/A until authorized — no implementation is in scope while this is DRAFT. When it opens,
M4 is the first item precisely because it is the oracle the other four need: a reader over the
revision chain can measure drift on real data BEFORE any of M1/M2/M3/M5 changes behaviour, and it
is also the only one whose baseline still exists going forward (the 20 generations that carried
the observed poisoning were deleted with the database on 2026-09-25 and are not recoverable).

## Residual

- The poisoning episode itself is unreproducible: its evidence lived in
  `.opencode/data/memory/revisions` and was removed with the wipe. Next occurrence: move the data
  directory aside (`data_crash_<date>`) rather than delete it — the symptom clears either way, the
  evidence only survives one of them.
- Whether the three carriers contribute equally is UNKNOWN; no measurement separates them.
