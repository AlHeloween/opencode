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
| **H3** evidence scope not expressed | **confirmed, narrowed by T0 to ONE axis: version/environment. Invalidation already exists.** | `constitution.ts:1227` a stamp carries `{claimDigest, evidenceRef, evidenceDigest, at}` where `claimDigest = contentHash(claim.text)` ⇒ **the statement itself is the scope**; `:1253` `invalidateClaim` revokes to `Unknown` with `invalidatedEvidenceRef`; `:1011` `STATEMENT_CHANGED` exists as an event kind. Absent on every axis: the **build/environment** — a stamp proven under version N is indistinguishable from N+1. "critical risks 0" is still ambiguous | a version-change probe: stamp a claim, bump the build, does the stamp survive? |
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
2. **H3 — bind the stamp to a version.** `ORACLE_STAMP` gains the version it was proven under, taken
   from the existing `session.version`; "critical risks 0" is disambiguated in G9's own wording.
   Oracle: a stamp produced under version N is readable as inapplicable to N+1.
3. **H1 — one clause separating the axes.** `@MEDOID_SIMPLEX`: independent sources are not independent
   explanations. Oracle: the clause renders; the phrase is distinct enough to pass `dedup.py`.
4. **H4 — one owner for the ladder.** `docs/agentic-reasoning-runtime.md` derives its table from
   `source.py` or declares itself a summary. Oracle: the two texts agree.
5. **T0 — settle H3's Unknown: where `ev_*` comes from.** One grep and one read. Until it runs, H3's
   decision is `Unknown`, not "absent".

## 5. The memory carrier must be budgeted (from the second review, and it is ours)

Measured today: `.opencode/data/memory/reasoning.md` is **281 347 bytes / 232 856 chars / 76 dated
entries**, and it is folded into `m*` **verbatim** on every fold. Three of our own instruments disagree
about its cost by **5×**:

```
kernel normalized counter    26 542
estimated @3.69 chars/token  63 105
estimated @1.78 chars/token 130 818
```

**None of them is the instrument that governs the fold** (`session/token-count.ts`, tiktoken
`o200k_base`). Setting a limit off the wrong instrument is the "two measures under one name" defect this
project has already paid for — so the task's first step is the measurement, not the number.

- **T-M1** — measure with the window's own counter. Oracle: the number comes from `token-count.ts`, not
  from a ratio. Until then the resident cost of memory is `Unknown`.
- **T-M2** — one declared limit, as a number where limits live (the `gateway.tda.*` precedent), never a
  constant inside a function.
- **T-M3** — the eviction unit is the **dated entry** (76 exist). Mechanical, no judgement.
- **T-M4** — eviction order: **closed episodes oldest-first; an entry carrying an ACTIVE criterion is
  pinned.** The mark already exists — a criterion carries scope, falsifier and status
  (`INTENTION_RESET`'s contract) — and the rule mirrors the summary nag ("only OPEN summaries get a line").
- **T-M5** — eviction is a **move, not a delete**: retired entries go to a generation file and stay
  addressable. Acquire / hold / release / re-acquire applied to memory itself.
- **T-M6** — a **dedup criterion for appends**: the kernel guards its own prompt against restatement
  (0.58 similarity, five-token boilerplate) and memory has no such guard, so appends accumulate
  paraphrases. An append that restates an existing criterion is a merge.

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
