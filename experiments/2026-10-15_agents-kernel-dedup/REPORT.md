# t48 — AGENTS.md ↔ kernel: deduplication map and kernel candidates

<!-- intention: AGENTS.md+kernel overlap unmeasured -> dedup map delivered (report only) -->

sv:
Keywords: dedup 0.30, kernel-mapping 0.25, classification 0.20, evidence-preservation 0.15, byte-accounting 0.10
Semantic dominant: Every AGENTS.md normative statement classified against the kernel text; candidates proposed with wording, byte cost and evidence; nothing cut.
md5: 3c9d2e7a1b4f6085a2d3e4f506172839
prev-md5: 8f3a2b1c4d5e6f708192a3b4c5d6e7f8
parent-goal-md5: e7dcd693e8e45671cf8dd84d97f6ff9b

Report only — no file outside this folder, the plan, and `_progress_log.md` was changed. A duplicate is NOT a
cut order: the owner approves every cut. Owner verbatim quotes and measured incidents are evidence, never
«verbosity».

## Method

- Read whole, with line numbers: `AGENTS.md` (751 lines, 51 036 B), `prompt_kernel/source.py` (1 213 lines,
  113 202 B on disk — comments included; the RENDER is what a session pays), `prompt_kernel/addons.py` (447),
  `addons_claude.py` (323), `addons_codex.py` (301), `addons_cursor.py` (326). Render surfaces measured:
  `packages/opencode/src/session/prompt/reasoning_prompt.txt` 66 115 B (opencode prefix),
  `.claude/reasoning_kernel.md` 65 987 B (Claude Code, 631 lines — same WORKFLOW text).
- Instrument note: codegraph was NOT the first call here, deliberately — the unit of analysis is every
  normative sentence of two known small files, not a symbol question; whole-file reads are the decisive
  instrument and both files are now fully in evidence. No graph query was skipped that would have answered
  anything the reads did not.
- Classification is per line (`experiments/2026-10-15_agents-kernel-dedup/measure.py`, map coverage 751/751,
  `missing: []`): DUP / PROJECT / KERNEL CANDIDATE / CONFLICT, plus NAV (pointers, not normative) and
  OVERHEAD (blanks, separators, section labels) so the four task classes stay clean.
- Both surfaces in one session is measured, not assumed: this session's own prefix carries AGENTS.md verbatim
  AND the kernel WORKFLOW; `.claude/reasoning_kernel.md` is the Claude Code copy of the same render.

## Summary — conflicts first

**Hard conflicts: 0.** No AGENTS.md statement contradicts the kernel text. Two soft tensions, named:

| # | AGENTS.md | Kernel | Reading |
|---|-----------|--------|---------|
| T1 | L104 «Prefer automation: execute requested actions without confirmation unless blocked by safety/irreversibility» | `source.py:603` AUTH_DECISION_RULE (ASK is a first-class decision), `source.py:474` INTENTION_CLARITY «Ask only what the user's words cannot answer» | Compatible if read as: never ask for CONFIRMATION of a clear request; the kernel's ASK is for decisions grounding cannot settle. The AGENTS.md wording («without confirmation») can be misread against the kernel's WAITING_APPROVAL pricing edges. Both texts current. Flag for the owner; not a cut order. |
| T2 | L102 «ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE» | `source.py:655` G7 ONE_TASK_OPEN «One bounded task open at a time. Two in flight share one oracle → neither attributable.» | Different objects — tool CALLS vs bounded TASKS — but the boundary is stated in neither text, so a session can read them against each other. One clause closes it: «parallel tool calls, never parallel bounded tasks» (~65 B, candidate C14). |

### Bytes per class (AGENTS.md, 51 036 B, 751 lines — measured, `measure.py`)

| class | lines | bytes | % of file |
|-------|------:|------:|----------:|
| DUP — kernel already says it | 62 | 5 327 | 10.4% |
| KERNEL CANDIDATE — kernel lacks it | 65 | 6 490 | 12.7% |
| CONFLICT (soft tensions) | 1 | 110 | 0.2% |
| PROJECT — host/project-specific | 441 | 30 911 | 60.6% |
| NAV — pointers, not normative | 96 | 7 010 | 13.7% |
| OVERHEAD — blanks/separators/labels | 86 | 437 | 0.9% |

### The overlap a session pays twice

Every session pays AGENTS.md (51 036 B) **and** the kernel render (66 115 B opencode / 65 987 B Claude Code)
≈ 117 KB of prefix. The **DUP 5 327 B** is the part of AGENTS.md the kernel already carries — paid twice,
every turn, in every session. The **CANDIDATE 6 490 B** is the opposite loss: knowledge that exists only in
AGENTS.md, so the kernel's other host variants (Claude, Codex, Cursor) never receive it at all. NAV 7 010 B
is pointers (cheap to keep, no kernel counterpart wanted). PROJECT 30 911 B is correctly homed.

Kernel headroom for candidates: render 66 115 B vs `utf8_budget=67_000` (`source.py:960`) → **885 B spare**.
The top candidate set below is ~1.26 KB → adopting it needs the standing budget step (the kernel's own
doctrine: «a missing rule costs whole runs of 100M tokens, while a line costs bytes. Cut prose, never a
decision», `source.py:971-972`; the cap is «a bloat guard, never a cut», `source.py:959`).

## Kernel candidates — ranked, with wording, byte cost, evidence

Byte costs are the proposed wording's own length (≈, not yet rendered). Home named per candidate.

| # | Candidate (minimal wording) | Home | ≈B | Evidence it is load-bearing |
|---|------------------------------|------|---:|------------------------------|
| C1 | «An answer in another language is a failed UNDERSTAND and returns the session to G0.» — append to G0 INPUT_LANGUAGE | `source.py:466` | 86 | Owner verbatim 2026-09-22: «ответ на языке отличном от языка пользователя автоматически перемещает в G0» (AGENTS.md:116). The kernel states the rule but not the consequence. |
| C2 | «A status surface always renders a value — the policy value or an explicit `unknown` — never nothing: to the user a missing indicator means «it does not work».» — new G7 addon line (ORACLE_ABSENCE) | `addons.py` G7 | 160 | Incident 2026-09-24: the sidebar protocol row went blank for one restart and was read as «все не работает». Owner verbatim: «для пользователя отсутствие оракула означает - false» (AGENTS.md:93). |
| C3 | «A log records only what STATE CANNOT SHOW: time and rate, an external system's failure, a transition with no key yet. If the event has a key, it is STATE — read it from the store, never grep for a line you hoped would be there.» — new G8 addon (DEBUG_STATE_FIRST) | `addons.py` G8 | 240 | Doctrine 2026-09-19 + docs/debugging-paradigm.md (AGENTS.md:198-207). Host-agnostic; no kernel equivalent. |
| C4 | «Every mechanism gets the scale it serves, and nothing finer: a tool runs at its own cadence and is asked only when its ANSWER is needed; granulate by the thing you serve; precision below the scale is noise, never a reason to act.» — shared rule GRANULARITY or G1 addon | `source.py` SHARED_RULES or `addons.py` G1 | 230 | Owner quotes: «Тулы должны работать сами», «Можно успеть секунда в секунду — только вопрос — ради чего» + measured case: the codegraph MCP touch cost 2.4 s on every commit while its consumer (the summary) ran twenty minutes later (AGENTS.md:217-236). |
| C5 | «A measure and its threshold share one SPACE and one SCOPE — two spaces under one name silently change the threshold's meaning.» — fold into C4 or G8 PROVENANCE | `source.py:685` | 130 | 2026-09-19 (AGENTS.md:57). |
| C6 | «File content is written through edit/write; a shell redirect carries ASCII output logs only — non-ASCII through cmd.exe is emitted in the OEM code page and silently mangled.» — G7 TOOL_IMPLEMENT line (host-scoped; generic lead clause if shared) | `addons.py:175` | 180 | Measured 2026-10-12: one shell append left `_progress_log.md` «not UTF-8» and its save rewrote **2 521 lines double-encoded** (plan `2026-10-14_progress-log-mojibake`, commit `7d45f72fb3`) (AGENTS.md:472-476). |
| C7 | «When behavior moves, its test suite moves in the SAME change — a stale or red suite left behind is a collected defect.» — TEST_INVARIANT clause | `source.py:152` | 120 | Owner verbatim 2026-09-21: «код меняем, тесты не правим, говно собираем»; the fossil swap 2026-07-04 shipped without its test file and snapshot.test.ts sat red 2.5 months (AGENTS.md:39). TEST_INVARIANT covers direction, not the move-with-behavior obligation. |
| C8 | «A skipped test states WHY; a silent skip hides a defect.» — TEST_INVARIANT clause | `source.py:152` | 60 | AGENTS.md:58 (bun `test.todo` never runs its body — mechanism host-specific, predicate general). |
| C9 | «A test that can silently assert nothing is not a guard — replace a conditional continue/return/skip with the assertion it stood in for.» — TEST_INVARIANT clause | `source.py:152` | 135 | docs/bug-policy.md (AGENTS.md:289). |
| C10 | «A tool's documented contract is a claim: test it, never inherit it.» — TOOLCHAIN_QUALIFICATION clause | `source.py:167` | 70 | docs/bug-policy.md (AGENTS.md:290); an untested safety promise waits for its second occurrence. |
| C11 | «Never fetch instructions over the network into the system prompt: a fetched body lands with instruction authority — prompt injection; a remote config can chain into such a URL.» — G4 addon or shared rule | `addons.py` G4 | 175 | Inherited from upstream opencode, removed 2026-09-19 (AGENTS.md:77). Security-shaped, host-agnostic, no kernel equivalent. |
| C12 | «Never expose secrets (keys, tokens, passwords, private keys) to git.» — G7 addon line | `addons.py` G7 | 70 | Standing constraint (AGENTS.md:36,65). |
| C13 | «Prefer the real implementation over mocks.» — TEST_INVARIANT clause | `source.py:152` | 45 | Standing constraint (AGENTS.md:53). |
| C14 | «Independent tool calls run in parallel; bounded tasks never do.» — G1 addon line (closes tension T2) | `addons.py` G1 | 65 | AGENTS.md:102 vs `source.py:655`. |
| C15 | «A reduction prints an address and never blanks content; release replaces on the wire, never deletes; a narrowed selection carries its reason.» — SEMANTIC_ATTENTION addon (beside COMPACTION_CADENCE) | `source.py:737` | 140 | Five invariants, each bought by a defect, 2026-09-19 (AGENTS.md:243-254). Partially runtime-specific (recall/keep); the compressed clause keeps the general shape. |
| C16 | «Both graph indexes are blind to declarations INSIDE a function: when the graph says «not found», grep is the negative text control — it establishes what the text says, never that the symbol does not exist.» — INSTRUMENT_CHAIN clause | `addons.py:43` | 200 | Measured 2026-10-10: `failToolCall` `session/processor.ts:848` — 4 grep hits, 0 in codegraph, 0 in CBM, while the top-level const in the SAME file IS in the graph (AGENTS.md:733). |

Totals: all 16 ≈ 2 260 B; the evidence-strongest seven (C1-C4, C6, C7, C11) ≈ 1 256 B → one budget step
(67 000 → 68 000) funds the top set; the full set needs ~69 000. Selection is the owner's.

## The map — every normative statement of AGENTS.md

Columns: line | gist | class | kernel address + quote (for DUP/CONFLICT) | evidence the AGENTS.md copy
carries that the kernel lacks | proposal. «→Cn» = covered by candidate Cn above. Kernel quotes are the
decisive fragment; addresses are `file:line`.

### Header, constraints (L1-61)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 34 | see `prompt_kernel/` for the kernel | PROJECT | — | path binding | stays |
| 35 | default branch Local_Development, NOT main | PROJECT | — | repo fact | stays |
| 36 | never expose secrets to public git | CANDIDATE | — | standing constraint | C12 |
| 37 | silent catch {} must log | PROJECT | — | coding standard (TS) | stays; internal dup ×6 (see below) |
| 38 | plan-to-code gaps are bugs — correct immediately | DUP | `source.py:625` G6 «eliminate plan-to-code gaps before mutation»; `source.py:656` G7 PLAN_EXECUTION «a plan-to-code gap is a blocking defect» | AGENTS.md adds «correct immediately»; kernel wording stronger (blocking defect, record lands in log) | pointer-able |
| 39 | test suite moves in the SAME change | CANDIDATE | — | owner quote 2026-09-21 + fossil-swap incident (2.5 months red) | C7 |
| 40 | KV cache byte-stable | DUP | `source.py:101-102` KV_CACHE_STABILITY «Installed system prefix = deterministic, byte-stable across turns. Before prompt/system changes → assess prefix impact. Mutable dates/counters/session markers/env observations → mutable tail.» | AGENTS.md adds SHA256→prefix-cache mechanism; kernel adds the mutable-tail escape | pointer-able (keep key-files line as PROJECT) |
| 41-47 | never run NN on CPU; pin device | PROJECT | partial: `source.py:499` G1 DEVICE_STATE «Device/hardware state observed, never recalled… Launcher quirk = pass device by hand, never fall back to slower.» | GPU-host fact + owner quote 2026-09-22 + the `device="cpu"` incident | stays (general half already in kernel) |
| 48 | never edit source with an unverifiable script; codegraph impact first | DUP (partial) | `source.py:631` G6 GROUND_PLAN_RULE «Impact query runs for every mutation binding: other consumers = answer, not precondition»; `addons.py:175` TOOL_IMPLEMENT «mutate: edit, write; crash-prone shell via cmd_runner» | docs/tool-playbook.md pointer + ADM descriptor contract. **Gap found: the opencode addon lacks the codex variant's «AST edits need a qualified tool; source-writing scripts are not a substitute» (`addons_codex.py:165`)** | port the codex clause into `addons.py` TOOL_IMPLEMENT, then pointer-able |
| 49 | no `.opencode/plans/` | DUP | `addons.py:29` PATH_GROUNDING «never store plans under .opencode/plans/.» | verbatim; AGENTS.md adds «only plans/ and plans_completed/» | pointer-able |
| 50 | plan hand-off is JOB FAILED (4 conditions) | PROJECT | partial: `source.py:715` BOUNDED_STOP_CONDITIONS, `source.py:116` REWARD_FUNCTION «ticked boxes alone do not complete it» | the four concrete plan-file conditions + owner dates | stays (plan-file mechanics) |
| 51 | after plan changes run explore agent | DUP | `source.py:575` G3 STRATEGY_AND_PORTFOLIO «Delegate existing-plan completion/strategy rechecks to a read-only explorer» | narrower instance | pointer-able |
| 52 | tests never from repo root | PROJECT | — | repo test layout | stays |
| 53 | avoid mocks — test the implementation | CANDIDATE | — | standing constraint | C13 |
| 54 | `_build.ps1` after tests/changes — mandatory | PROJECT | — | build script + owner quote 2026-10-03 | stays |
| 55 | never run the full package test suite | PROJECT | partial: `addons.py:258` RUN_ARTIFACT_FIRST «an oracle that cannot print its verdict is not an oracle: a suite cut off by crash, kill or timeout yields UNKNOWN» | measured 18 min, `bytes_written: 0`, ~5 GB RSS + owner verbatim | stays |
| 56 | don't litter `.opencode/` | PROJECT | partial: `addons.py:116-117` PATH_EXPERIMENTS «scratch: experiments/…» | owner verbatim 2026-09-20 + the experiments/ convention | stays |
| 57 | measure and threshold share SPACE and SCOPE | CANDIDATE | — | 2026-09-19 | C5 |
| 58 | skipped test states WHY; `test.todo` is not a test | CANDIDATE | partial: `source.py:152` TEST_INVARIANT «No weakening, deletion or skip to get green» | bun mechanism | C8 |
| 59 | heavy test files carry FILE-level timeout | PROJECT | — | bun-specific | stays |
| 60 | reach providers from the HIGHEST surface | PROJECT | — | provider-reach postulate + docs | stays |
| 61 | tool names ARE wire ids | PROJECT | — | DeepSeek/dsml-normalizer specifics | stays |

### forbidden_actions (L63-83)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 64 | never touch `bin/` | PROJECT | — | owner verbatim 2026-09-24 + the bin-surgery incident | stays |
| 65 | secrets to git (2nd copy of L36) | CANDIDATE | — | — | C12 |
| 66 | no `git push --no-verify` | PROJECT | — | git workflow | stays |
| 67 | silent catch (2nd) | PROJECT | — | — | stays |
| 68 | no «pre-existing» labels | DUP | `source.py:162` CAUSAL_ATTRIBUTION «„Pre-existing“ is a claim, not an exemption: same predicate, same harness, before revision…» | kernel STRONGER (operational test); AGENTS.md adds «every error is a deliverable» | pointer-able |
| 69 | `.opencode/plans/` (2nd) | DUP | `addons.py:29` | verbatim | pointer-able |
| 70 | KV cache (2nd) | DUP | `source.py:101-102` | — | pointer-able |
| 71 | repo-root tests (2nd) | PROJECT | — | — | stays |
| 72 | full suite (2nd) | PROJECT | — | — | stays |
| 73 | never change Global.Path.home | PROJECT | — | path architecture | stays |
| 74 | never hand-edit ADID receivers | PROJECT | — | ADID framework | stays |
| 75 | never reopen the SDK/upstream question | PROJECT | — | STOP section + measured diff | stays |
| 76 | never regenerate `gen/` folders | PROJECT | — | hand-maintained source | stays |
| 77 | never fetch instructions over the network | CANDIDATE | — | prompt-injection rationale, removed from upstream 2026-09-19 | C11 |
| 78 | no new JSON file for runtime state | PROJECT | — | storage paradigm | stays |
| 79 | no read-time inheritance — fill, never resolve | PROJECT | — | storage paradigm rule 4 | stays |
| 80 | sdk build.ts exit 0 is not success | PROJECT | — | measured ~7100 lines deleted | stays |
| 81 | no legacy version/transport pin (2nd of L60) | PROJECT | — | — | stays |
| 82 | never rewrite `/v1` → `/v3` | PROJECT | — | dialect marker | stays |
| 83 | no per-request descent probing (3rd of L60) | PROJECT | — | — | stays |

### invariants (L85-93)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 86 | default branch (2nd) | PROJECT | — | — | stays |
| 87 | every catch must log (2nd) | PROJECT | — | — | stays |
| 88 | silent catch (3rd) | PROJECT | — | — | stays |
| 89 | plan docs match code (2nd of L38) | DUP | `source.py:625,656` | — | pointer-able |
| 90 | `.opencode/plans/` (3rd) | DUP | `addons.py:29` | — | pointer-able |
| 91 | `--no-verify` (2nd) | PROJECT | — | — | stays |
| 92 | provider rungs name the probe | PROJECT | — | catalog discipline | stays |
| 93 | **absence of an oracle reads as FALSE** | CANDIDATE | — | incident 2026-09-24 + owner verbatim «для пользователя отсутствие оракула означает - false» | C2 |

### acceptance_tests (L95-110)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 96-100 | self-tests: branch, catch, plan files, KV, `--no-verify` | PROJECT | — | acceptance list for the above | stays |
| 101 | answer in the user's language — reasoning included | DUP | `source.py:466` G0 INPUT_LANGUAGE «Always think and respond in the user's input language — reasoning included, not just the final answer» | AGENTS.md adds the auto-return consequence + owner quote | pointer-able after C1 lands (keep the quote line) |
| 102 | always use parallel tools | CANDIDATE | — | standing acceptance test | C14 |
| 103 | default branch (3rd) | PROJECT | — | — | stays |
| 104 | prefer automation without confirmation | CONFLICT (soft T1) | `source.py:603` AUTH_DECISION_RULE; `source.py:474` INTENTION_CLARITY | — | flag to owner; optional C14-style boundary clause |
| 105-110 | not a branch of anything | PROJECT | — | measured divergence (190 files, 0 identical) | stays |

### Language (L112-123)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 112-121 | the language rule + auto-return to G0 | DUP | `source.py:466` G0 INPUT_LANGUAGE | owner quote 2026-09-22; the auto-return consequence is kernel-absent | pointer-able after C1 |
| 123 | pointer to docs/agentic-reasoning-runtime.md | NAV | — | — | stays |

### Project Paradigm (L134-156)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 134-145 | outer-loop paradigm, no big untestable jobs | PROJECT | — | architecture doctrine + docs pointers | stays |
| 150 | prefer small named testable tasks | DUP | `source.py:513` G2 objective «small, independent, smoke-testable candidate tasks» | — | pointer-able |
| 151 | REUSE.BEFORE non-trivial invent | DUP | `source.py:493` G1 REUSE_BEFORE «Search existing code, history, plans, and authoritative prior art before non-trivial invention; re-search after repeated stuck failure.» | verbatim-equivalent | pointer-able |
| 152 | SMOKE.BEFORE implementation | DUP | `source.py:578` G3 SMOKE_BEFORE | kernel much fuller (predict per case, trader's rule) | pointer-able |
| 153 | summaries are Inferred handles | DUP | `source.py:494` G1 MEMORY_RANK «Rank active-window evidence above compacted handles. Recall and user assertions are testimony» | — | pointer-able |
| 154 | do not hand-edit ADID receivers | PROJECT | — | two-canon protocol | stays |

### Debugging / Granularity / Content lifecycle (L195-256)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 195-207 | read state before adding a log (3 allowed log uses) | CANDIDATE | — | doctrine 2026-09-19 + docs/debugging-paradigm.md | C3 |
| 212-214 | hashing is never the suspect | PROJECT | — | measured 332 MB/s, ≈29 ms | stays |
| 217-236 | granularity: the scale a mechanism serves | CANDIDATE | — | owner quotes + measured 2.4 s codegraph case | C4 |
| 240-254 | content lifecycle: five invariants | CANDIDATE | — | five defects, 2026-09-19 | C15 |

### Continuity (L259-279)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 259-279 | tail inviolate; contiguous; range accounting | PROJECT | partial: `source.py:737` SEMANTIC_ATTENTION COMPACTION_CADENCE «Compact at closed boundary, never on window fill…» | product compaction design + owner quotes | stays; optional: absorb «the tail is inviolate» into COMPACTION_CADENCE (~60 B) |

### Bug Policy (L281-291)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 283 | no unimportant bug | PROJECT | — | bug attitude | stays |
| 284 | NO pre-existing errors | DUP | `source.py:162` CAUSAL_ATTRIBUTION | kernel stronger | pointer-able |
| 285 | bugs block push | PROJECT | — | git workflow | stays |
| 286 | silent catch (4th) | PROJECT | — | — | stays |
| 287 | plan-to-code gaps (2nd) | DUP | `source.py:625,656` | — | pointer-able |
| 288 | tests adapt to functionality, never the reverse | DUP | `source.py:152` TEST_INVARIANT «A red after an edit is first a question about the TEST — is it current against the requirement? Code fitted to a stale test breaks what the requirement protects» | owner quote 2026-09-30 | pointer-able (keep quote) |
| 289 | a silently-asserting test is not a guard | CANDIDATE | partial: TEST_INVARIANT «No weakening, deletion or skip to get green» | the replace-with-assertion mechanic | C9 |
| 290 | a tool's documented contract is a claim | CANDIDATE | partial: `source.py:167` TOOLCHAIN_QUALIFICATION «verify the fixture's state, not the tool's return» | the contract-testing obligation | C10 |
| 291 | write-path oracles inspect the artifact | DUP | `source.py:682` G8 ORACLE «sits on claim's LAYER (persistent write proven by reading artifact back, not typecheck)» | — | pointer-able |

### KV cache / Checkpoint (L295-311)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 295-299 | byte-stable; assess impact; `[KV-CACHE RISK]` flag | DUP | `source.py:101-102` KV_CACHE_STABILITY | AGENTS.md adds the SHA256 mechanism | pointer-able |
| 301 | key files list | PROJECT | — | paths | stays |
| 307-311 | per-model encrypted checkpoints | PROJECT | — | product design | stays |

### Plan Maintenance (L315-359)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 317-323 | MASTER_PLAN direction; SV per plan; manifest per task | PROJECT | partial: `source.py:87` CURRENT_SV «every artifact — document, plan, task, goal level — carries its OWN @SV_FORMAT vector» | plan-file mechanics (sv, manifest, eta_turns, renderer wins) | pointer-able for the SV clause; mechanics stay |
| 325 | the renderer WORKS — run it | PROJECT | — | measured two-render check | stays |
| 330 | plans/ locations | PROJECT | partial: `addons.py:290` PATH_CLOSURE «SUCCESS -> plans_completed/; OUT_OF_SCOPE -> plans_deferred/…» | repo paths | pointer-able for the moves |
| 331 | never `.opencode/plans/` (4th) | DUP | `addons.py:29` | verbatim | pointer-able |
| 332-333 | audit plans; tasks are `- [ ]` boxes | PROJECT | — | planstatus tool + measured 2026-10-12 | stays |
| 334 | PRE_FLIGHT smoke gate: `## Smoke Tests` before edits | DUP | `addons.py:131` PATH_PLANS «plans: plans/[ISO8601]_<description>.md; Smoke Tests before G4.» | verbatim | pointer-able |
| 335 | plan-to-code gaps (3rd) | DUP | `source.py:625,656` | — | pointer-able |
| 336 | use messagesearch to verify completion | DUP | `addons.py:316` TOOL_CLOSURE «verify completion: messagesearch; git status.» | verbatim | pointer-able |
| 337 | scan active plans for stale refs | DUP | `addons.py:290` PATH_CLOSURE «…scan stale refs; use `git mv` in a commit naming the ground.» | verbatim | pointer-able |
| 341-349 | JOB FAILED (2nd copy of L50) | PROJECT | partial: `source.py:715` | owner dates | stays |
| 352-359 | a commit is NOT closure | PROJECT | partial: `source.py:116` REWARD_FUNCTION «completed = acceptance … oracle-confirmed, ticked boxes alone do not complete it»; `source.py:715` | the commit-must-name-the-plan mechanic | pointer-able for the principle |

### Style / Backup / Fossil / Paths (L365-435)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 367-388 | Google TS + MetaMask guides; inline/destructuring/const/else/snake_case | PROJECT | partial: `addons.py:210` STYLE_AUTHORITY names the guides | the five concrete TS rules (docs/style-guide.md is canon) | stays |
| 393-395 | edit-tool `.bak` backups | PROJECT | — | product behavior | stays |
| 399-418 | fossil snapshot system | PROJECT | partial: `addons.py:90` VCS_ROLES «git = the code's history… snapshot.fsl is NOT the organization but the runtime's undo timeline» | the four boundaries, `track(undefined)`/`track([])` semantics, pinned source | stays |
| 422-435 | opencode paths table | PROJECT | — | path architecture | stays |

### Shell restrictions / toolchain / build (L439-560)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 441 | constitution hard-blocks shell enumeration | DUP | `addons.py:55` TOOL_GROUNDING «file enumeration: list/glob/grep/read — never shell ls/dir/find/cat (hard-blocked).»; `addons.py:176` «shell = process orchestration only; never file browsing (constitution blocks).» | verbatim | pointer-able (table stays as PROJECT) |
| 443-459 | the shell command table | PROJECT | — | this host's tool table | stays |
| 461-465 | crash-prone binaries via cmd_runner | DUP | `addons.py:175` + `addons.py:202` PROCESS_LAUNCH | verbatim | pointer-able |
| 468 | override env vars | PROJECT | — | runtime constitution detail | stays |
| 470 | unknown apps are crash-prone too | DUP (partial) | `addons.py:202` «launch via cmd_runner start (non-blocking; jobwait/jobkill) — a bare start hangs the TUI» | the fail-closed unknown-app wrap | pointer-able (partial) |
| 472-476 | never write file content through shell echo | CANDIDATE | — | mojibake incident 2026-10-12, 2 521 lines double-encoded | C6 |
| 481-489 | host toolchain; `bun typecheck` | PROJECT | — | measured inventory | stays |
| 493-495 | `_build.ps1` after tests/changes | PROJECT | — | owner quote 2026-10-03 | stays |
| 500-520 | full suite forbidden (2nd of L55) | PROJECT | partial: `addons.py:258` | owner verbatim + the RED-clearance rule | stays |
| 524-537 | TUI testing workflow; API-key-blocked final tests | PROJECT | — | owner 2026-10-08 (keys/money) | stays |
| 540-552 | process launch policy (TUI-hang) | DUP | `addons.py:202-203` «launch via cmd_runner start (non-blocking; jobwait/jobkill) — a bare start hangs the TUI»; «permanent services: nssm install, never ad-hoc detach.» | verbatim for both rows; AGENTS.md adds the 2026-09-08 incident | pointer-able (keep incident line) |
| 554-556 | cmd_runner vs cua division | PROJECT | — | docs/tools-and-sidecars.md | stays |

### Auto-generated / kernel workflow / catalog / provider (L561-653)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 561-568 | gen folders hand-maintained; kernel sync | PROJECT | partial: `addons.py:140` TOOL_AUTHORIZE «kernel source: prompt_kernel/source.py -> python -m prompt_kernel --install; the installed .txt is generated, never hand-edited.» | the 4-step workflow + pytest gate | pointer-able for the install line |
| 572-579 | kernel development workflow; addons.py for host bindings | PROJECT | partial: `addons.py:140` | the pytest gate + rebuild step | stays |
| 583-587 | dependency catalog | PROJECT | — | consolidate_catalog.py | stays |
| 591-631 | provider reach postulate + 5 guards | PROJECT | partial: `source.py:187` ANTI_CHURN persists «failed approaches» | per-provider numbers, `alt-svc` oracle, VERIFIED_NOVITA_OPTIONS | stays |
| 636-647 | vendor reasoning contract | PROJECT | — | DeepSeek 400s case, vendor matrix | stays |
| 651-653 | `OPENCODE_MARKDOWN` default true | PROJECT | — | product flag | stays |

### Search instruments / CodeGraph (L723-750)

| line | gist | class | kernel address + quote | evidence kept/lost | proposal |
|------|------|-------|------------------------|--------------------|----------|
| 723-731 | the graph-before-text order | DUP | `addons.py:43` INSTRUMENT_CHAIN «graph-before-scanners on indexed code: query relevant symbols/consumers before glob/grep/read…»; `addons.py:47` «instrument chain, in order: where/which -> adm --query -> codegraph -> messagesearch -> universalsearch -> glob -> grep» | AGENTS.md's own words admit it: «the kernel's own chain, made blunt here because it keeps being skipped» | pointer-able |
| 733 | grep as the negative text control | CANDIDATE | partial: `addons.py:219` SEARCH_OUTPUT_SHAPE «…re-run it with a control that MUST match» | measured 2026-10-10 (`failToolCall`, 4 grep / 0 graph) | C16 |
| 737 | a skipped graph call is the grounding step skipped | PROJECT | — | KAIZEN instance | stays |
| 739-741 | reach for CodeGraph before grep/find | DUP | `addons.py:43` | — | pointer-able |
| 742-750 | sync procedure, config, RAG-first | PROJECT | partial: `addons.py:47` refresh sentence | owner quote 2026-10-03 | stays |

## DUP disposition — pointer-able vs must-stay

**Pointer-able without losing evidence** (the AGENTS.md copy could become a one-line pointer; kernel already
carries the predicate): L38/89/287/335 (plan-to-code), L49/69/90/331 (`.opencode/plans/`), L51, L68/284
(pre-existing), L101+112-121 (language — after C1), L150-153 (obligations), L288 (keep the owner-quote line),
L291, L295-299 (KV), L320-323 (SV clause only), L330 (moves only), L334, L336, L337, L352-359 (principle
only), L441, L461-465, L470 (partial), L540-552 (keep the incident line), L566 (install line only),
L723-731, L739-741.

**Must stay as-is** (the AGENTS.md copy carries a half the kernel lacks): L40 (SHA256 mechanism), L48
(playbook pointer + ADM contract — and the codex-clause gap below), L50/341-349 (the four JOB FAILED
conditions), L55/500-520 (the measured stall + RED-clearance rule), L56 (owner quote), L317-325 (renderer +
manifest mechanics), L332-333 (boxes + planstatus), L367-388 (the five TS rules), L399-418 (fossil
boundaries), L591-631 (provider numbers), L636-647 (vendor matrix).

## Internal duplication inside AGENTS.md (a second economy, same defect class)

The four YAML blocks at the top repeat each other heavily — the same statement appears 2-6 times:

| statement | copies (lines) | count |
|-----------|----------------|-------|
| silent catch {} must log | 37, 67, 87, 88, 97, 286 | 6 |
| KV cache byte-stable | 40, 70, 99, 297, 299 | 5 |
| `.opencode/plans/` prohibited | 49, 69, 90, 331 | 4 |
| default branch Local_Development | 35, 86, 96, 103 | 4 |
| provider highest-surface reach | 60, 81, 83, 92 | 4 |
| plan-to-code gaps are bugs | 38, 287, 335 | 3 |
| `git push --no-verify` | 66, 91, 100 | 3 |
| full package test suite | 55, 72, 500(+section) | 3 |
| no «pre-existing» labels | 68, 284 | 2 |
| secrets to git | 36, 65 | 2 |
| repo-root tests | 52, 71 | 2 |
| JOB FAILED | 50, 341-349 | 2 |
| language rule | 101, 112-123 | 2 |

This is AGENTS.md-internal (not AGENTS.md↔kernel), so it is reported, not classified: collapsing the four
blocks to one statement each would free roughly 4-5 KB without touching any kernel question. Owner approves
every cut.

## Side findings

1. **Variant-parity gap (kernel-side, actionable):** `addons_codex.py:165` TOOL_IMPLEMENT carries «AST edits
   need a qualified tool; source-writing scripts are not a substitute» — the opencode `addons.py:175`
   TOOL_IMPLEMENT does not. AGENTS.md:48 is the only place the opencode host reads that prohibition. Porting
   the clause closes the gap and makes AGENTS.md:48 pointer-able.
2. **The kernel render and AGENTS.md agree on the language rule** but only AGENTS.md carries the consequence
   (auto-return to G0) — C1.
3. **NAV block is 7 010 B (13.7%)** of AGENTS.md — the Documentation Index (L670-720) alone is ~3.4 KB of
   pointers. No kernel counterpart wanted; it is navigation, and it works.

## Residual (what this report does NOT do)

- No cut, no kernel edit, no AGENTS.md edit — the owner approves every change (task rule).
- Candidate byte costs are the proposed wordings' own lengths, not rendered-and-measured; a `python -m
  prompt_kernel --install` pass would give Exact numbers per adopted candidate.
- T1/T2 dispositions are the owner's call; this report only names the texts and the reconciling reading.
- t47 owns the whole-base-load measurement; this report maps content overlap only.
