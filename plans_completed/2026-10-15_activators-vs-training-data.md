<!-- intention: no systematic mapping kernel activators to pretraining corpora -> REPORT.md inventory plus corpus mapping plus synthesis plus two measurement designs with source stamps -->
<!-- goal_sv: Keywords: activators 0.30, training-corpora 0.25, source-routing 0.20, hybrid-reasoning 0.15, engram-multimodality 0.10; Semantic dominant: Map every kernel named authority to its documented pretraining-corpus presence and turn the gaps into measured experiments. md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 prev-md5: 00000000000000000000000000000000 parent-goal-md5: 00000000000000000000000000000000 -->
# t50 — research: our kernel activators vs standard pretraining datasets

## Goal

Inventory every activator named in `prompt_kernel/source.py` (@SOURCE_ROUTING
routes, methods/standards, structural vocabulary), map each to the documented
composition of standard pretraining / fine-tuning corpora from PRIMARY sources
(dataset papers and cards), and design — not run — the two pending measurements
(gates as thinking-mode switch; text-vs-image on structure tasks). Report only:
no kernel edits. No keys, no paid APIs.

## Constraints

- Work in `D:\zPython\opencode` on branch `Local_Development`. No checkout, no worktree.
- Commit ONLY own paths (`git add <path>…`, never `-A`). `_progress_log.md` shared: append, keep BOTH entries on conflict. index.lock → wait 5 s, retry.
- Trials / probes go to `researcher_agent` sub-agent (owner, 2026-10-08).
- Web work delegated to `researcher_agent` (universalsearch hybrid default; webfetch for primary pages). Verdicts stay with Smit.
- Evidence ladder: dataset card / paper = primary authority (Inferred with url + content hash); blogs/snippets stay Guess/Hypothetical; no «X is in training data of model M» without M's own disclosure.
- Bounds: steps 60, tools 150, loops 3, depth 2, time 5 400 000 ms.

## Tasks

- [x] <!-- sv: Keywords: activators 0.40, source-routing 0.30, kernel-inventory 0.20, standards 0.10; Semantic dominant: List every named authority, method and structural term exactly as the kernel spells it. md5: 11111111111111111111111111111111 prev-md5: 00000000000000000000000000000000 parent-goal-md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 --> T1 Q1 inventory activators from `prompt_kernel/source.py` (do not recall): all @SOURCE_ROUTING primaries/secondaries per discipline, methods/standards (falsification incl. falsifier wording, LEAN tiers, Manhattan L1/medoids, JIDOKA, KAIZEN, ISO/IEC 25010, ISO/IEC/IEEE 29119-1, style guides per language), structural vocabulary (gates G0–G9 incl. FSM, oracle, reward R, claim/risk ledgers, divergence, SV/SVM). Oracle: `source.py` line pins for each name. RECEIPT: REPORT.md ##Q1 (routes :870-886, falsifier 18 hits, Popper 0 control-verified, ISO :970, styles addons.py:216); local reads — hash n/a.
- [x] <!-- sv: Keywords: corpora 0.35, pile-redpajama-dolma 0.30, open-paywalled 0.20, shares 0.15; Semantic dominant: Ground each activator in the documented corpus that does or does not contain its source. md5: 22222222222222222222222222222222 prev-md5: 00000000000000000000000000000000 parent-goal-md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 --> T2 Q2 corpora mapping from PRIMARY sources: The Pile (22 components), RedPajama v1/v2, Dolma, FineWeb / FineWeb-Edu, C4, RefinedWeb, The Stack v1/v2, peS2o / S2ORC, ROOTS, plus model-report disclosures (Llama, OLMo, DeepSeek, Qwen, GLM). Per activator: containing corpora + rough share when documented; open vs paywalled (Westlaw/HeinOnline/Reaxys/eHRAF by reference, not full text). Oracle: dataset paper/card URL + content hash per row claimed Documented. RECEIPT: REPORT.md ##Q2 + §Source hashes №1-22 (all fresh sha256, 2026-10-16).
- [x] <!-- sv: Keywords: reward 0.35, falsification 0.30, gates-density 0.20, corpora-papers 0.15; Semantic dominant: Locate where reward, falsification and gate/FSM language is dense in the corpora. md5: 33333333333333333333333333333333 prev-md5: 00000000000000000000000000000000 parent-goal-md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 --> T3 Q3 reward / falsification / gates density: RL + RLHF papers on arXiv, philosophy of science, state machines in code. Mark Documented vs Inferred per claim. Oracle: at least one primary citation per density claim. RECEIPT: REPORT.md ##Q3 + hashes №23-26 (PPO/InstructGPT/survey/OpenFst) + №42 (PhilPapers §2.19).
- [x] <!-- sv: Keywords: hybrid-reasoning 0.35, thinking-switch 0.30, gates-oracle 0.20, sv-marker 0.15; Semantic dominant: Establish how hybrid models select thinking mode and design the token-count plus SV-emission measurement. md5: 44444444444444444444444444444444 prev-md5: 00000000000000000000000000000000 parent-goal-md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 --> T4 Q4 gates as thinking-mode switch from primary sources: DeepSeek V3.1+/V4 template switch + API params, Qwen3 / GLM hybrid and «auto» thinking, Claude adaptive thinking — explicit template/API switch (prompt cannot override) vs learned prompt-sensitive decision; whether prompt structure (gates, explicit verification steps) is documented to raise thinking depth. Design (do NOT run paid calls) the measurement: reasoning-token counts from usage field, same task, gates present vs absent, on free models (Muse 1.3 Spark, GLM-5.3-Flash) — oracle is the token count, not self-report — plus binary cheap observable: @SV_FORMAT block present/absent (owner field case: first SV from DeepSeek once gates were placed). Oracle: design lists task, both prompts, usage field to read, confounders. RECEIPT: REPORT.md ##Q4+M1 + hashes №27-32 (V3.1 card, DS thinking guide, Qwen3-32B, AlibabaCloud, Z.AI, Claude steering).
- [x] <!-- sv: Keywords: 3fs 0.30, engram 0.30, kv-cache 0.20, lookup-keys 0.20; Semantic dominant: Separate 3FS prefix-cache infrastructure from Engram lookup memory and test the exact-name-as-key hypothesis. md5: 55555555555555555555555555555555 prev-md5: 00000000000000000000000000000000 parent-goal-md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 --> T5 Q5 3FS vs Engram, two layers apart: (a) 3FS Fire-Flyer File System (github.com/deepseek-ai/3FS; README line 44 names KVCache, found via Sourcegraph 2026-10-15) — disk-backed KV cache behind prefix caching, implications for byte-stable prefixes + cache-hit pricing; (b) Engram «Conditional Memory via Scalable Lookup» (github.com/deepseek-ai/Engram, paper + demo) — model-side lookup memory; hypothesis: exact names and fixed terms act as lookup keys, paraphrase misses. Establish from primary sources whether Engram ships in any released DeepSeek model (V4?) — without disclosure stays Unknown. Oracle: repo README/paper line pins + disclosure verdict per layer. RECEIPT: REPORT.md ##Q5 (3FS no-prefix-claim Unknown; Engram-27B experimental, V4 Unknown) + hashes №33-35.
- [x] <!-- sv: Keywords: multimodality 0.35, code-structure 0.30, vision-models 0.20, text-vs-image 0.15; Semantic dominant: Document natively multimodal pretraining effects on code and design the text-vs-image structure probe. md5: 66666666666666666666666666666666 prev-md5: 00000000000000000000000000000000 parent-goal-md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 --> T6 Q6 native multimodality + code from primary sources: what is documented about natively multimodal pretraining (document images, code/UI screenshots, diagrams, tables) and its effect on code/structure tasks; which of our models are natively multimodal per their own disclosure (Muse Spark 1.3, Fable, LongCat 2.5 per owner — confirm). Design (do NOT run paid calls) the measurement on free models: same structure-heavy task (table-driven refactor, indentation-sensitive edit) as text vs rendered image. Oracle: design lists task, both presentations, scoring rubric. RECEIPT: REPORT.md ##Q6+M2 (Qwen2-VL/2.5-VL/Chameleon, ablation Unknown; Spark native / Fable vision-input / LongCat vendor-claimed) + hashes №36-41.
- [x] <!-- sv: Keywords: synthesis 0.40, activation-strength 0.30, weak-strong 0.20, resonance-map 0.10; Semantic dominant: Reduce all findings to one activator table with documented versus inferred strength and the resonance-map consequences. md5: 77777777777777777777777777777777 prev-md5: 00000000000000000000000000000000 parent-goal-md5: a1b2c3d4e5f60718293a4b5c6d7e8f90 --> T7 Q7 synthesis + REPORT.md assembly: table activator → corpus presence → expected activation strength (documented / inferred / unknown); weak (paywalled, rare) vs strong names; consequences for the pending name-vs-paraphrase experiment (memory: kernel resonance map). Deliverable `experiments/2026-10-15_activators-vs-training-data/REPORT.md` + source list with stamps. Oracle: REPORT.md exists, covers Q1–Q7, every Documented row carries url + hash, no kernel file touched. RECEIPT: REPORT.md ##Q7 (11-row strength table, stratification consequences) + §Source hashes 42/42 fresh sha256; archive experiments_history/2026-10-15_activators-vs-training-data/ (REPORT.md 313+ lines, SOURCES.md 92 lines, content-checked).

## Smoke Tests

- Baseline (before any edit): `prompt_kernel/source.py` reads at the pins named in T1; plan file absent (`read` reports missing — the control that proves the write is new).
- Post-change: plan file exists with `<!-- intention: … -->` + per-task `<!-- sv: … -->` + `## Smoke Tests`; REPORT.md exists under `experiments/2026-10-15_activators-vs-training-data/` covering Q1–Q7 with url+hash source list; `git status --short` shows ONLY own paths; `_build.ps1` green (state.json read).
- Expected delta: missing → present on both artifacts; no `packages/opencode/src/**`, no `prompt_kernel/**`, no `bin/**` in the diff.

## Risks

- R1 paywalled-source overclaim: mitigated by open-vs-paywalled column + «by reference, not full text» rule; verification owner Smit.
- R2 «X is in training data of M» without M's disclosure: mitigated by disclosure-required rule; verification owner Smit.
- R3 paid API / key leak: mitigated by design-not-run for both measurements, no keys; verification owner Smit.
- R4 shared-tree collision (two other robots on disjoint paths): mitigated by `git add <own paths>` only + `_progress_log.md` append with BOTH-entries rule; rollback = unstage own paths.

## Claims

- C1 Q1 names are read from `prompt_kernel/source.py`, not recalled. Falsifier: a name in REPORT.md with no source.py pin.
- C2 Every «Documented» corpus-presence row cites a dataset paper/card (url + content hash). Falsifier: a Documented row without one.
- C3 No training-data attribution to a named model without that model's own disclosure. Falsifier: one such sentence.
- C4 Both measurement designs are runnable without paid calls or keys. Falsifier: a step requiring either.
- C5 3FS and Engram are reported as separate layers with separate verdicts. Falsifier: a merged claim.

## Residual (bounded, with routes)

- R-M1/M2 execution: designs in REPORT.md ##Q4/##Q6, NOT run — by design, no paid calls without owner go. Route: owner decision → new task under this plan's successor.
- R-hashes: researcher-reported hashes (SOURCES.md, pre-2026-10-16) superseded by 42 fresh Smit sha256 (REPORT.md §Source hashes); re-fetch only on divergence (re-digest mismatch → Unknown per @DIVERGENCE_PROTOCOL).
- R-ROOTS roster: full 46-language list lives in paper appendix/tooling, not fetched. Route: G1 grounding leaf if ever needed.
- R-FineWeb-Edu per-domain: no per-domain (PubMed) score breakdown in primaries. Route: classifier-score probe (needs HF inference — owner go).
- R-prompt-override: no precedence rule found on DeepSeek/Qwen/GLM API docs. Route: re-check on doc updates.
- R-Engram-in-V4: no disclosure found → stays Unknown. Route: disclosure watch on deepseek-ai/Engram + V4 product pages.
