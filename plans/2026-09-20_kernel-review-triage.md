<!-- intention: an external review of the kernel text arrives as seven architectural hypotheses and is read as if it described the system -> each hypothesis is settled against the running system before any change, and only contract-level gaps are patched, in three phases with the kernel build isolated last -->

# Kernel review triage — seven hypotheses settled against the running system

Two external reviews are inputs to this plan, not verdicts.

- **GPT6AstraPro** audited the **kernel text** and produced H1–H7.
- **Gemini** audited the **task brief** and produced five structural points.

By `@SOURCE_ROUTING` both are `Hypothetical` (no authority, no local code). By the norm this
session installed (`@MEDOID_SIMPLEX`), each is **one medoid** — one model, one pass, one source.
Their agreement is therefore a second point, not a simplex, and neither authorizes a change.

**The measured reason to distrust a text-only reading:** four of the seven hypotheses are answered by
code the kernel text does not describe — `session.ts:819` (session removal), `sync/index.ts:367`
(aggregate journal purge), `session/recovery.ts:144` (a replay consumer that exists and does something
else), `projectors.ts` (message/part are projections of `event`). A review of the text cannot see them.

## 1. Three phases, and why the kernel build is last

Measured: a kernel install rewrites the system prefix, while **the running session keeps the old prefix
until a new session or a fold**. Applying kernel changes mid-audit therefore makes the **audited
artifact differ from the executing artifact** — so evidence gathered under version N silently stops
covering N+1. That is H3's own defect (an oracle stamp with no version scope), and both reviewers
converged on it independently.

| phase | what it does | what it may touch |
|---|---|---|
| **0 — audit** | one hypothesis at a time, verdict per hypothesis, evidence quoted | **read only** |
| **1 — contract patch-sets** | only confirmed gaps, at the level that owns them | `prompt_kernel/source.py`, docs |
| **2 — isolated build** | kernel build → render to the owner's eyes → install → repin | build artefacts |

Phase 0 closes each hypothesis with a **memory write** (PASS / FAIL / Unknown) before the next begins;
each hypothesis gets a full cycle, so a fold can land between them without losing the front.

## 2. Triage (first pass — verdicts are provisional until the per-hypothesis oracle runs)

| | verdict | evidence | instrument to settle |
|---|---|---|---|
| **H1** sources ≠ explanations | **confirmed — and it hits a norm written today** | `@MEDOID_SIMPLEX` says "≥3 medoids with independent **sources**"; three sources supporting ONE explanation are a degenerate simplex. The axes are conflated **in my clause** | kernel text; the fix is one clause |
| **H2** no consistent completion path | **confirmed: tables disagree, not a missing edge** | installed prompt `:481` `PLAN_MODE gates: [G0…G6, G9]`, yet `forward_move` has no `G6 -> G9` and G7 is not in those gates. Second instance: `STALL` is a declared state (`@LOOP_PROGRESS` → ASK; `INTENTION_RESET` → REASONING_MODE) with **no edge at all** | installed prompt; grep the transition table |
| **H3** evidence scope not expressed | **CLOSED 2026-09-20: the premise is REFUTED — the axis is unreachable, and the real gap is volatility.** | `constitution.ts:1043` keeps the entire epistemic state in a **module-private in-memory Map** (`SessionEpistemic`: ledger, evidence, events, stamps, evidenceFloor), created empty per session (`:1055`) and never serialized, stored or hydrated — validated tree-wide, not from one file: the only producer/consumer pair in `packages/opencode/src` is the model's own `claim_ledger` ingest (`processor.ts:1292`) and `epistemicNudge` (`processor.ts:639`). A stamp cannot outlive its process, and a process IS one build ⇒ a version field would ALWAYS equal the running version: a constant, never a check. Invalidation and statement-scope do exist (`:1227`, `:1253`) | **The residual is bigger and different:** after any restart or build bump the agent's epistemic position resets to EMPTY while the transcript still says which claims were stamped — the record and the runtime disagree, silently. The fix is a DECISION (persist the ledger, or state the volatility in the contract), not a binding. Also found: `resetEpistemicState` (`:1064`) and `getClaimEvidenceEvents` (`:1211`) are exported with **0 call sites** in `src` |
| **H4** ladder read contradictorily | **confirmed at doc level, already queued as L4** | `docs/agentic-reasoning-runtime.md:111-116` states a looser rule than the kernel ⇒ a second owner of one ladder. Also: the ladder is an order of **statuses**, not a procedure — read as procedure it forces a web search before local code | doc + kernel diff |
| **H5** attention conflates observation/research/execution | **not confirmed: closed by existing mechanisms** | `@SV_FORMAT.invariant` "an attention fingerprint, **never a claim status**"; `@SV_TARGET` "not the current vector, not a claim, **not ACL**"; the right to steer changes is gated by `@AUTHORITY_SEPARATION` + `@PLAN_CONTRACT_ENFORCEMENT`. An unverified hypothesis in the vector cannot authorize a change | none — quote the clauses |
| **H6** labels become fictitious evidence | **semantics closed; observability absent** | kernel already forbids the misuse ("32 hex … **not a checksum** … never present a self-computed match as evidence") and already says what a break means. No form check, no record of a break | grep for md5 continuity across a fold |
| **H7** the key scenario | **the owner exists and is not what the review proposed** | within a step, effect and record are **atomic** (`runBatch` → one `projectTransaction`, `behavior: immediate`); the journal **detects** a lost event (`seq`, `Sequence mismatch`); **but no boot-time replay is called by anything** — the consumers are session import, the HTTP sync route and the control-plane workspace | who calls `replay` at boot (answered: nobody) |

## 3. Rejected proposals (recorded, so they are not re-proposed)

| proposal | rejected because |
|---|---|
| a new `RUNTIME_CHECKPOINT` layer (H7) | the carriers already exist and are layered by lifetime: `event` journal + projections, fossil leaves, `jobs.db` + orphan recovery, `session.recovery`, and the atomic step transaction. A new layer would be a second owner of state that is already owned |
| a new terminal, or bolting `G6 -> G9` on (H2) | the host already implements a completion semantic (`planexit` → the user switches identity). The defect is that the **tables disagree**; declare the routes, do not add a state |
| a new SV format or mask (H5) | the separation already exists: attention (`@SV_FORMAT`), assignment (`@SV_TARGET`), claim status (ledger), authority (`@AUTHORITY_SEPARATION`) |
| real content hashing for the SV labels (H6) | the kernel forbids it by name — the label is a high-entropy name, not a checksum |
| Gemini's concrete rewrite of "eliminate continuity gaps" as *"the result status did not return to `CLAIM_LEDGER`"* | **it names the wrong object.** A tool result's status lives in the part's `state` (`completed`/`error`); `CLAIM_LEDGER` holds claims with `digest`/`status`/`stamp`. A result is not "returned to" the ledger. The abstraction is real; the proposed concrete form is wrong about our data model |
| "any deviation → immediate reset" (H6) | the kernel already separates four different things (format violation, linkage loss, semantic drift, no progress); an automatic reset destroys useful state and can create its own cycle |

**The measured replacement for Gemini's vague trigger, first person, with a date:** a `cmd_runner` run
had finished (`state.json`), the confirmation had not arrived (empty `stdout_text.log`), and the agent
read a completed run as a hang and killed live tests. That is H7's scenario in the wild.

## 4. Phase 1 patch-sets

Full patch-bindings are written when each is taken. Order follows dependency, not importance.

1. **H2 — DONE 2026-09-20.** Declared `G6 -> WAITING_APPROVAL` (the handover) and `G8 ->
   WAITING_APPROVAL` on STALL. Two findings changed the fix: **(a)** a branch on the success path is
   **not expressible** — `validate.py:41` requires the forward edges to be exactly the canonical spine,
   so the attempted `G6 -> G9` was rejected by the kernel's own validator and is recorded as a residual
   at the edit site rather than forced through a `side` edge whose meaning is a concern loop;
   **(b)** `PLAN_MODE` listed `G9` while lacking `G8`, and the runtime ACL denies it `bash`/`cmd`/`run`
   **and** `pipeline`, so `G9` was unreachable by oracle and by delegation alike ⇒ **the gate list was
   wrong, not the ACL**, and `G9` was removed. The mirror of that list turned out to be a **test**
   (`test_agent_identity.py:43`), updated with the reason in place.
   Oracle: **99 passed / 1 failed** (the red is the promotion gate), render `2026-09-20_13-24-39`
   lines 40/41/483, `utf8_bytes=35628`, `working_copy=not_updated`.
2. **H3 — CLOSED 2026-09-20, and NOT as a binding.** The probe was answered by reading rather than by
   running, and it REFUTES the premise: `constitution.ts:1043` keeps the entire epistemic state in a
   module-private in-memory `Map`, created empty per session and never serialized, persisted or
   hydrated — validated tree-wide, since the only producer is the model's `claim_ledger` ingest
   (`processor.ts:1292`) and the only consumer is `epistemicNudge` (`processor.ts:639`). **A stamp
   cannot outlive its process, and a process is one build**, so a version field would always equal the
   running version: a constant, never a check. Binding it would have added decoration — the exact
   failure mode this triage exists to catch, and the reason the probe came first. The real residual is
   bigger: after any restart the agent's epistemic position resets to EMPTY while the transcript still
   says which claims were stamped. That is a decision (persist the ledger, or state the volatility in
   the contract), so it is recorded for the owner rather than taken.
3. **H1 — DONE 2026-09-20.** The clause now reads "…pins from one source are one point repeated, and
   three sources resting on ONE explanation are a degenerate simplex — it is the explanations that must
   be independent, not only the sources." The defect was in the wording of a norm written the same day,
   which is why the pin is the line itself (`source.py:163`) rather than a mechanism.
   Oracle: the phrase renders in `dist/2026-09-20_14-16-43_reasoning_prompt.txt` (hunk `@@ -271,3 +273,3 @@`);
   the suite's own dedup guard passes; the render moved 35 628 -> 35 914 bytes.
4. **H4 — DONE 2026-09-20, and it returned NO kernel budget (checked, not assumed).** The doc's §4 held
   a second, looser ladder **and contradicted itself**: the diagram sent web+code to Hypothetical while
   the table called the same steps Inferred — and both were looser than `@SOURCE_ROUTING`, which requires
   primary authority or local code for Inferred. The section now derives from the kernel and names it as
   the owner. Oracle: the two texts agree, and the kernel render is unchanged by it because it is a doc
   and not prompt text — so the 86 spare bytes stand.
5. **T0 — DONE 2026-09-20.** The runtime consumer EXISTS and is **stricter** than the norms describing
   it: `session/constitution.ts` mints evidence as a content digest, holds **two tool tiers**
   (`ORACLE_EVIDENCE_TOOLS` 19 / `EXACT_ORACLE_TOOLS` 12), refuses a bind on six grounds including
   `missing_falsifier`, and hard-gates mutation on ungrounded premises. **Its own conclusion — "the ONE
   missing axis is build/environment" — was later REFUTED by the H3 probe (item 2): the axis is
   unreachable because the carrier is volatile.** The two norms that restated it were then aligned with
   the code (`@CLAIM_CITATION` names the required falsifier; `@INSTRUMENT_RUNG` says eligibility does not
   transfer).

**Phase 2 — DONE 2026-09-20: the isolated install, and it proves itself.** `python -m prompt_kernel
--install` → `installed=0ae3b7f80e7b154fc5063af47a2cda3a1d55a2db5db97b69a067d6e29c5d86e7`,
`utf8_bytes=35914` of 36 000 (**86 spare, measured, not estimated**), `working_copy=updated`.
`install_production` was READ before it ran, which is how the repin was known to be mine: it returns
`sha256(runtime)` (`cutover.py:70`) and never touches the manifest, so `baseline.json` was repinned by
hand — and the install's returned digest proved EQUAL to the render's `sha256`, verified rather than
assumed. Oracle: the promotion gate was **red** before the install (99 passed / 1 failed) and **GREEN**
after it (**100 passed** in 0.97 s) — that red-to-green transition is the proof the install landed, which
is exactly why a kernel change is committed only after it. Commits: `21469aeb4e` (the kernel),
`5a544fe027` (the log).
**Live status:** nothing reaches a running session until the binary is rebuilt AND a new session or a
compact picks up the prefix — a checkpoint holds the old one.

## 5. The memory carrier must be budgeted (from the second review, and it is ours)

**T-M1 — DONE 2026-09-20: the number is MEASURED, with the instrument that governs the fold.**
`experiments/2026-09-20_memory-budget/memory-tokens.ts` (and its `.out.txt`) drives the real
`countTokens()` from `session/token-count.ts` over the real carrier:

```
exact=true                      the tokenizer ran — this is NOT the chars/4 fallback
bytes=303353  chars=251723  tokens=72771
entries=82                      independently confirmed against 82 dated headers
```

⇒ **The resident cost of memory is 72 771 tokens per fold — 7.6 % of the 957 232 fold budget.** Its
real divisor is **3.46 chars/token** (mixed Russian/English technical prose). The rivals, for the
record — and note WHICH one was worst:

| instrument | value | error |
|---|---:|---:|
| **the fold's own counter (exact)** | **72 771** | — |
| `@3.69 chars/token` | 68 218 | −6.3 % |
| `chars/4` | 62 931 | −13.5 % |
| `@1.78 chars/token` | 141 418 | +94 % |
| the kernel's normalized counter (at the earlier 281 347 B) | 26 542 | ≈ **−2.7×** |

**The worst of the four is the counter we use to budget the PROMPT** — a different SPACE, i.e. exactly
the "two measures under one name" defect this project has already paid for. Neither cheap instrument is
admissible here; the measurement is, and it cost one script.

**Eviction material (T-M3/T-M4), measured:** the distribution is FLAT — median entry **831 tokens**,
largest 2 536 (**3.5 %** of the total), 5 largest 2 536/1 815/1 624/1 623/1 536. Reaching any target
means dropping a NUMBER of entries, not one fat one, which is what makes "oldest-first, ACTIVE criterion
pinned" the right unit rather than a size heuristic. `count_ms=1331` includes the one-time tiktoken init
in a fresh process; the same package's own bench records 1.9 Mchars/s for pure encoding, so the encode
is ~130 ms of that — arithmetic from two measurements, not a separate run.

**A HOLE IN THE PIN RULE, found by the owner's own question** («Сорян, погоди что ты собрался
выкидывать?») and measured with `experiments/2026-09-20_memory-budget/memory-composition.ts`:

```
total                        72 758 tok · 82 entries
pinned (carries ACTIVE)       5 987 tok ·  8 entries
closed history (no ACTIVE)   66 771 tok · 74 entries
declared limit               96 000 tok   ⇒ entries displaced TODAY = 0
```

So at today's size the whole mechanism is a **no-op** — 72 758 < 96 000, and it is a bound, not a cut.
**But the pin test is unsafe as written:** the oldest entries of the "closed" class are NOT the most
worthless. The first three are 2026-09-12, and two of them are the *misattribution-reflex* self-analysis
and the repair-decision — durable criteria the agent still works under, carrying no `Status: ACTIVE`
line, so the mechanical test would retire them FIRST. The plan's own falsifier catches it: *after
rotation the agent must not have to re-derive a criterion it had already written* — and a LESSON is not
a statused criterion, so it looks exactly like a task log to the test.

**Revision, applying to every variant:** (a) the pin widens to "carries an ACTIVE criterion **or** a
durable lesson/criterion marker"; (b) an eviction LEAVES A ONE-LINE INDEX in the resident file — date ·
headline · where the entry went — so retirement is visible and reversible **from the file itself** and the
falsifier is checkable by reading rather than by memory (cost measured: 74 × ~15 tok ≈ **1 100 tok**
resident).
- **T-M2 — DONE 2026-09-20.** The declared ceiling is `MEMORY_TOKENS_LIMIT = 96_000` in
  `packages/opencode/src/memory/budget.ts`, named at module scope — **not a literal inside a function**.
  It is deliberately NOT a config key: the only reader would be this flag, and requiring `Config.Service`
  in the memory tool would break its fixture layer (`test/tool/memory.test.ts` builds AppFileSystem +
  Spawner + Truncate + Agent). One line to add if the owner wants it configurable.
- **T-M3 / T-M4 / T-M5 — SUPERSEDED, NOT IMPLEMENTED.** They described an automaton, and the owner
  rejected it while the measurement backed him (the oldest entries are the most ALIVE). What exists
  instead: the flag names the oldest dates when it fires, and **nothing moves**.
- **T-M6** — a **dedup criterion for appends**: the kernel guards its own prompt against restatement
  (0.58 similarity, five-token boilerplate) and memory has no such guard, so appends accumulate
  paraphrases. An append that restates an existing criterion is a merge.

### REVISED 2026-09-20, on the owner's objection — and the objection is correct

Owner, verbatim: «Стоп, ты хочешь чтобы твоя память ротовалась сама собой?» The original shape (a
declared limit that MOVES the oldest entries out when crossed) was wrong in three measured ways:

1. **A threshold may not be an actor.** A token count deciding what the agent forgets is a decision
   taken by nobody — the silent class this whole session has been hunting (a silent `catch {}`, a silent
   no-op, a silent write). Forgetting is an act; an act needs an author: the agent while curating, or
   the owner.
2. **Retention by AGE is refuted by the measurement two sections above.** The oldest entries of the
   "closed" class include the *misattribution-reflex* criterion — the most alive thing in the file — so
   oldest-first is a proxy for OLD, not for worthless. It would retire that entry first.
3. **The real defect is duplication, not size**, and a size guard does not touch it. Project rule: a
   defect is fixed by REMOVING A SURFACE, not by adding a guard. **T-M6 is the fix**; T-M3…T-M5 were a
   guard around a cause nobody had addressed.

**Corrected shape:**

- **The limit stays, as a MEASURED FLAG and never an actor:** one line in the MUTABLE TAIL (`memory at
  X of Y tokens; oldest closed entries: …`) — the same shape as the summary nag that already exists
  ("only OPEN summaries get a line"). It SUMMONS an actor; it moves nothing.
- **T-M4 (the schedule) becomes MATERIAL, not a mechanism:** when the flag fires, that list is what the
  ACTOR is shown; it is not a queue that fires itself.
- **T-M5 (the move) survives only as a deliberate act**, and it MUST leave the one-line pointer, so
  whatever moved is visible from the resident file rather than silently absent.
- **T-M6 (merge-on-append) is promoted to the first task** — it removes the cause, and it is curation
  the agent performs while writing, not a background process.

### AS BUILT 2026-09-20

`memoryFlag(text, limit)` + `oldestEntryDates(text, n)` in `packages/opencode/src/memory/budget.ts`
(pure, no write path at all), wired into the **`append` and `write` outputs** of `src/tool/memory.ts` —
**deliberately not into `read`**, whose output IS the file (asserted by its own tests) and where a caller
echoing a read back into `write` would copy the flag into the carrier. Growth happens on mutation, so
that is where the actor sees the number.

Oracles: `bun typecheck` exit 0 (a baseline was taken BEFORE the edit, also 0);
`test/memory/budget.test.ts` + `test/tool/memory.test.ts` **11 pass / 0 fail / 23 expect**; and the flag
driven over the REAL carrier by `experiments/2026-09-20_memory-budget/flag-live.ts`.

**T-M6 is a discipline, not code:** merge-on-append is an act of curation the agent performs while writing
(read the carrier first; if a criterion is already there, rewrite that entry merged rather than append a
paraphrase). It needs no mechanism — which is exactly why it is the right fix: the cause is duplication.

**But that discipline is NOT PERFORMABLE with today's tool surface at this size, and that is a surface
problem rather than a policy one:** `append` only appends, and merging a dated entry means rewriting the
whole ~250 KB carrier through `write` — which cannot be reproduced by hand and is priced in output tokens.
So the carrier's growth is **FORCED by the surface**, not by anyone's discipline. The realistic deliberate
act when the flag fires is a consolidation `write` (the previous content is kept in `revisions/`), or a
small bounded tool addition: an action that replaces ONE dated entry. Recorded, not taken — and it is the
honest reason the FLAG carries the weight here and the merge discipline does not yet.

**Invariant and falsifier.** What must never happen: after rotation the agent must **not** have to
re-derive a criterion it had already written. Falsifier: any re-derivation of a retired-but-still-true
criterion ⇒ the budget cut the wrong thing. This is the same shape as the continuity doctrine's own
falsifier ("if you go and check what your window held, the boundary broke continuity").

## 6. Smoke Tests

- **baseline (before any Phase 1 edit):** `python -m pytest prompt_kernel/tests/ -q` → **100 passed**;
  `bun typecheck` exit 0 from `packages/opencode`.
- **per patch-set:** the kernel suite green; the new line found **in the rendered artefact** by grep
  (a registry entry that does not render is indistinguishable from a deleted one — the `PATH_EXPERIMENTS`
  lesson); `dedup.py` does not flag a restatement.
- **phase 2:** render to the owner's eyes → `--install` → `prompt_kernel/baseline.json` repinned →
  the compatibility gate that blocked the promotion turns green (it is the oracle that the install landed).
- **T-M1:** the memory cost is read from the window's counter and recorded with the instrument named.

**Explicitly not claimed.** A week of autonomy is a target horizon, not a result. The measured horizon
today is **8.94 h of active work on a session whose window peaked at 391.9 k and never folded**; the
session that crossed the fold (786.2 k, 378 folds) died. Contract checks, driven fault reproduction, a
long run and a run at the target horizon are four different things and will be reported separately.

## 7. Residuals

- **CORRECTED, one hour after this plan was first written: the claim-citation half DOES have a runtime
  consumer, and the earlier "no consumer" claim was wrong.** Measured in `session/constitution.ts`:
  `:1186` `id: ev_${digest.slice(0, 24)}` (an evidence id IS a content digest), `:1155-1158` evidence
  nothing stamps is evicted, `:1215` `bindOracleEvidence`, `:1227` a stamp carries
  `{claimDigest, evidenceRef, evidenceDigest, at}`, `:1253` `invalidateClaim` with
  `invalidatedEvidenceRef`, and `:1417`/`:1427` parse `oracle_stamp:`/`divergence_event:` out of the
  model's own output. **What is still open, and it splits the item in two:** (a) does that path
  **enforce** — refuse a MODIFY for an unpinned claim — or only **record**? (b) the norms installed
  today (`@INSTRUMENT_RUNG`, `@MEDOID_SIMPLEX`) have consumers only if they are plugged into this
  existing machinery rather than into a new one.
- Orphaned projections: `session` removal leaves `message`/`part` behind while purging their journal
  (`sync/index.ts:367`), so their provenance is gone and `recovery.restore` refuses them by construction.
  Measured: 9 470 messages / 37 261 parts here; 130 / 488 in the production worktree. Needs a cascade or
  a declared retention rule.
- The production worktree (`D:\zPascal\XEComponents`) runs build **10.0.996**, predating every fix made
  since; its last activity is `2026-09-18 15:42:02`, with `time_compacting` still set. Rebuild and deploy
  before any further unattended run there.
