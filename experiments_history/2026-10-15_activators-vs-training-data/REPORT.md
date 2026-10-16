# t50 — Kernel activators vs standard pretraining datasets (REPORT)

Plan: `plans/2026-10-15_activators-vs-training-data.md` · Report only — no kernel edits.
All web evidence via `researcher_agent` (universalsearch + webfetch, primary pages only).
Verdicts: Smit. No keys, no paid APIs. Nothing was executed against a paid endpoint;
both measurement designs are designed-not-run.

Rung key: **Documented** = primary-authority page fetched (paper / card / canonical
repo README / vendor docs) ≈ Inferred rung; **Inferred** = reasonable derivation from
a documented fact; **Unknown** = unfetched or unquantified; **Guess** = snippet-only
(never used as fact here). No «X is in training data of model M» without M's own
disclosure — enforced throughout.

---

## Q1 — Activator inventory, read from `prompt_kernel/source.py` (not recalled)

Source pins are `source.py` line numbers as read 2026-10-15/16 (1218-line file).
Style guides live in `prompt_kernel/addons.py`, not `source.py` — recorded precisely.

### 1a. @SOURCE_ROUTING routes (source.py:848-888)

Contract tag `SOURCE_ROUTING`, alias `DOMAIN_SOURCES` (:848-850).
Ladder (:851-857): snippet→Guess; fetched web→Hypothetical; primary authority or
local code→Inferred; reproduced smoke/PoC PASS→Exact; failed proof→Unknown.
`generic_web_rule` (:860): generic web never becomes Inferred; remote Inferred needs
`source_stamp {authority_class, url_provenance, content_hash}`.

| discipline | primary authorities (exact spelling) | secondary | lines |
|---|---|---|---|
| physics / science | arXiv, APS_Journals | INSPEC, IOPscience, NASA_ADS | :870 |
| chemistry / science | PubChem, NIST_WebBook | ChemRxiv, Reaxys | :871 |
| materials / science | MaterialsProject, SpringerMaterials | mdx, MatWeb | :872 |
| geology / science | USGS_Pubs, GeoRef | GeoScienceWorld | :873 |
| biology / biomed | PubMed, GenBank | BioRxiv, NCBI_Taxonomy | :874 |
| medicine / biomed | CochraneLibrary, PubMed | MEDLINE, CINAHL | :875 |
| psychology / biomed | PsycINFO, PsycArticles | PubMed, OSF_Preprints | :876 |
| agriculture / biomed | FAO, AGRICOLA | AGRIS, CAB_Abstracts | :877 |
| engineering | IEEEXplore, EngineeringVillage | Compendex, INSPEC | :878 |
| cs | ACM_DL, arXiv_CS | IEEEXplore, CiteSeerX | :879 |
| law | HeinOnline, Westlaw | LexisNexis, ScholarCaseLaw | :880 |
| sociology / social | ICPSR, SocINDEX | SocAbstracts, AgeLine | :881 |
| economics / social | FRED, NBER | RePEc, WorldBankData | :882 |
| history / social | JSTOR, HathiTrust | InternetArchive, ProjectMUSE | :883 |
| education / social | ERIC, OECD_Ed | EdSource, LearnTechLib | :884 |
| anthropology / social | eHRAF, AnthroSource | AIO | :885 |
| software | official_docs, canonical_repo | package_registry, accepted_spec | :886 |

Class rules (:861-867): science (DOI/peer-review beats preprint); biomed (Cochrane/
guidelines outrank preprints); engineering (standard number/version, spec,
measurement provenance); law (jurisdiction/edition/date/registry; commentary cannot
outrank primary law); social (dataset version/date/methodology/primary source);
software (exact version, official docs/spec/repo; blogs cannot outrank spec).

### 1b. Methods / standards

- **falsifier** (the kernel's spelling — the noun is *falsifier*, not
  *falsification*): 18 hits in source.py, incl. GUESS_DECIDES_NOTHING (:57,
  "certainty without a falsifier is a symptom, not a rung"), CLAIM_LEDGER_RULE /
  CLAIM_CITATION (:579-580), CLAIM_LEDGER field (:1036), OUT_OF_SCOPE falsifier
  (:1173). **Documented** (read).
- **Popper**: 0 hits in source.py; control `falsifier` on the same path/filter
  returns 18 hits, so the zero is a true absence, not a filter artefact.
  **Documented** (absence, control-verified).
- **@LEAN_RANKING** 4 tiers (:559 + G8 re-classification :680). **Documented**.
- **@MANHATTAN_L1 / L1_DISTANCE** (:535; term :1005: additive Manhattan distance;
  G2 sufficiency ≥5 candidates or proven small space :245-251). **Documented**.
- **EVIDENCE_MEDOID** (:1011). **Documented**.
- **@JIDOKA** (:176-177), **@KAIZEN** (:181-182). **Documented**.
- **@REWARD_FUNCTION** R formula (:116 + predicate :125). **Documented**.
- **ISO/IEC 25010 + ISO/IEC/IEEE 29119-1**: one comment at :970 (acceptance
  criteria at requirements time; testing concepts). **Documented**.
- **Style guides**: NOT in source.py — `prompt_kernel/addons.py:216`: Python PEP-8;
  JS/TS Google JS Style Guide + Prettier/ESLint; Go gofmt + Effective Go; C/C++
  clang-format + Google C++ Style Guide; Rust rustfmt; Delphi Embarcadero Style
  Guide (+ MSVC MSDN, 8051 Intel MCS-51 in the rendered G7 rule). **Documented**
  (location recorded exactly).

### 1c. Structural vocabulary

Gates G0–G9 + spine/edges (:1080-1179), per-gate FSMs (G0_FSM :209, G1 :224,
G2 :253, G3 :268, G4 :284, G5 :298, G6 :312, G7 :327, G8 :342, G9 :366),
ORACLE_ROLE (:997), CLOSURE (:998), RESIDUAL (:999), DIVERGENCE_PROTOCOL (:62),
CLAIM_LEDGER (:1036), RISK_LEDGER (:1037), SMOKE_CONTRACT (:1038),
SOURCE_STAMP (:1052), SV contract + SVM (:1060). **Documented** (read).

---

## Q2 — Corpus mapping (primary sources)

### The Pile — Documented (Gao et al., arXiv:2101.00027, Table 1, §2; weights = % bytes)

Pile-CC 18.11 · PubMed Central 14.40 · Books3 12.07 · OpenWebText2 10.01 ·
ArXiv 8.96 · GitHub 7.59 · FreeLaw 6.12 · StackExchange 5.13 · USPTO 3.65 ·
PubMed Abstracts 3.07 · Gutenberg 2.17 · OpenSubtitles 1.55 · Wikipedia(en) 1.53 ·
DM Mathematics 1.24 · Ubuntu IRC 0.88 · BookCorpus2 0.75 · EuroParl 0.73 ·
HackerNews 0.62 · YoutubeSubtitles 0.60 · PhilPapers 0.38 · NIH ExPorter 0.30 ·
Enron Emails 0.14.
URLs: https://arxiv.org/html/2101.00027v1 · https://arxiv.org/abs/2101.00027 ·
https://github.com/EleutherAI/the-pile

### RedPajama — Documented (2411.12372, §3/Table 2; HF card togethercomputer/RedPajama-Data-1T)

v1 (1.2T): CommonCrawl 878B · C4 175B · GitHub 59B · Books (Gutenberg+Books3) 26B ·
ArXiv 28B · Wikipedia 24B · StackExchange 20B. Card omits the Books row and marks
`book` config defunct (Books3 copyright) — documented discrepancy, both counts ≈1.2T.
v2 (web-only, 30T): 84 CC snapshots; deduped head+middle 20.8B docs / 30.4T tokens
(Mistral BPE) + ~50 quality-signal tags.
URLs: https://arxiv.org/html/2411.12372v1 · https://huggingface.co/datasets/togethercomputer/RedPajama-Data-1T ·
https://github.com/togethercomputer/RedPajama-Data

### Dolma 3T — Documented (2402.00159, Table 1; HF card allenai/dolma)

v1.6: CommonCrawl 2,281B (74.6%) · The Stack 411B (13.4%) · C4 198B (6.5%) ·
Reddit 89B (2.9%) · peS2o 70B (2.3%) · Gutenberg 6.0B · Wikipedia+Wikibooks 4.3B =
3,059B. v1.7 (different mixture, not the 3T paper) adds RefinedWeb 456.4B,
StarCoder 263.8B, arXiv-from-RedPajama 28.0B, StackExchange-from-RedPajama 19.6B…
URLs: https://arxiv.org/html/2402.00159v2 · https://huggingface.co/datasets/allenai/dolma

### FineWeb / FineWeb-Edu / C4 / RefinedWeb — Documented

- FineWeb (2406.17557): 96 CC snapshots (WARC, trafilatura), 15T tokens (GPT-2);
  per-snapshot MinHash dedup; C4 filters except terminal-punctuation; 3 custom
  heuristics (~22% removed). https://arxiv.org/html/2406.17557v1
- FineWeb-Edu: 1.3T tokens at score ≥3 (92% of FineWeb removed); annotations by
  Llama-3-70B-Instruct, classifier = linear on frozen Snowflake-arctic-embed-m
  (F1 82%); **explicitly prompted NOT to favour highly technical pages such as
  arXiv abstracts** — Documented (paper §4 + card). No per-domain (PubMed) score
  breakdown → PubMed-like scoring is **Unknown**.
  https://huggingface.co/datasets/HuggingFaceFW/fineweb-edu
- C4: single snapshot (April 2019 CC); C4.en 365M docs / 156B tokens; rules:
  langdetect ≥0.99, terminal-punctuation + ≥3-word lines, ≥5 sentences, drop
  lorem-ipsum / `{` / javascript / terms-of-use / blocklist, 3-sentence-span dedup.
  Blocklist removes AAE 42% / Hispanic-aligned 32% vs WAE 6.2% — Documented
  (Dodge et al. 2021, §4). https://arxiv.org/html/2104.08758v1
- RefinedWeb (2306.01116): ~5T English tokens, web-only (100% Web row), MDR
  pipeline, neutral filtering (no ML quality filter), ~90% of CC docs removed;
  public extract 600B. https://arxiv.org/html/2306.01116v1

### The Stack — Documented (2211.15533; 2402.19173; HF cards bigcode/the-stack[-v2])

v1: 3.1TB/30 langs → v1.1 6.4TB/358 langs (193 permissive licences); dedup 2.9TB;
MinHash+LSH Jaccard 0.85, ~40% near-dups. v2: 67.5TB full / 32.1TB dedup,
619 langs (go-enry + inspection), ~900B train tokens; sources = Software Heritage
2023-09-06 + GHArchive; ScanCode licence detection; content filters (paper §2.1).
URLs: https://arxiv.org/abs/2211.15533 · https://arxiv.org/html/2402.19173v1

### peS2o / S2ORC — Documented (github.com/allenai/peS2o; ACL 2020 acl-main.447)

peS2o v2: 38.97M docs / 42.01B whitespace tokens (s2orc full-text 8.24M/36.09B +
s2ag title+abstract 30.57M/5.92B), cutoff 2023-01-03. S2ORC: 81.1M papers,
8.1M OA full texts (ACL 2020, Lo et al.).
URLs: https://github.com/allenai/peS2o · https://aclanthology.org/2020.acl-main.447/

### ROOTS — Documented (Laurençon et al., arXiv:2303.03915)

1.6TB, 59 languages (46 natural + 13 programming), 498 constituent datasets;
~62% catalogue/pseudo-crawl/code, ~38% filtered OSCAR-21.09; byte shares EN 30.03 /
ZH 16.16 / FR 12.9 / ES 10.85 / PT 4.91 / AR 4.6. Full 46-language roster lives in
appendix/tooling, not in fetched text → **Unknown** here.
URL: https://arxiv.org/abs/2303.03915

### Model-report disclosures (only what each report states)

- Llama 2: 2T tokens, "new mix of publicly available online data" (no named
  corpora). Llama 3/3.1: ~15T tokens; mix ≈50% general / 25% math+reasoning /
  17% code / 8% multilingual (no named corpora). https://arxiv.org/html/2307.09288v2 ·
  https://arxiv.org/html/2407.21783v3
- OLMo: Dolma 2,668B tokens. https://arxiv.org/html/2402.00838v4
- DeepSeek V3: 14.8T tokens, no source breakdown. R1: ~800k SFT. https://arxiv.org/html/2412.19437v2 · https://arxiv.org/html/2501.12948v1
- Qwen2: 7T+ tokens. Qwen3: ~36T, 119 languages. https://arxiv.org/html/2407.10671v1 · https://arxiv.org/html/2505.09388v1
- GLM-4: tens of trillions, CN+EN + 24 languages. https://arxiv.org/abs/2406.12793

---

## Q3 — Reward / falsification / gates density

- RL/RLHF on arXiv — **Documented**: PPO 2017 https://arxiv.org/abs/1707.06347 · InstructGPT 2022 https://arxiv.org/abs/2203.02155 · RLHF survey 2023 https://arxiv.org/abs/2312.14925. arXiv CS slice is 8.96% of the Pile, 28B of RedPajama-v1, inside peS2o/S2ORC. **Inferred** (density, not a counted share).
- Falsification/Popper — **Documented home, Unknown passage**: Pile §2.19 PhilPapers slice (0.38%, https://ar5iv.labs.arxiv.org/html/2101.00027); a specific Popper passage inside is unproven without a corpus grep. The kernel spells *falsifier* (18 hits), never Popper.
- Gates/FSM — **Documented**: OpenFst repo https://github.com/google-research/openfst proves FSM/FST vocabulary lives in open code; kernel FSM fleet (source.py:203-384) is code-shaped text of the kind The Stack and GitHub slices carry at scale. **Inferred** (genre presence, not gate-word counts).

---

## Q4 — Gates as a thinking-mode switch (primary vendor docs)

- DeepSeek — **Documented**: self-hosted V3.1 = explicit chat-template flag thinking=True/False (https://huggingface.co/deepseek-ai/DeepSeek-V3.1; https://docs.vllm.ai/projects/recipes/en/stable/DeepSeek/DeepSeek-V3_1.html). Hosted API = model/param switch (deepseek-chat vs deepseek-reasoner; V4 thinking type + reasoning_effort; https://api-docs.deepseek.com/guides/thinking_mode/). Prompt-text override of either control: **Unknown**.
- Qwen3 — **Documented**: enable_thinking True/False + /think /no_think tags (https://huggingface.co/Qwen/Qwen3-32B; https://www.alibabacloud.com/help/en/model-studio/deep-thinking).
- GLM — **Documented**: per-request thinking type enabled/disabled (https://docs.z.ai/guides/capabilities/thinking-mode). Learned prompt-sensitive auto-decision: **Unknown**.
- Claude — **Documented**: manual budget switch vs adaptive thinking type=adaptive (https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost).
- Prompt structure raising thinking depth: **Unknown** as documented causal claim; Claude adaptive is the one mechanism where prompt sensitivity is documented by design.

### Measurement design M1 (designed, NOT run; no keys, no paid calls)

- Task (fixed): 3 small structure-heavy items (table-driven refactor; indentation-sensitive Python edit; claim-with-falsifier rewrite).
- Condition A: task + full kernel gate wrapper (G0–G9 headers, CLAIM_CITATION, @SV_FORMAT demand). Condition B: bare task text, same content.
- Models: Muse 1.3 Spark, GLM-5.3-Flash (free tier we hold).
- Observables: (1) reasoning-token count from the usage field (the oracle — never self-report); (2) binary: @SV_FORMAT block present or not.
- Procedure: A/B/A/B alternation per model, same session age, fixed sampling params.
- Confounders logged: time-of-day routing, free-tier swaps, prompt-length cost, session-length cache effects. Prediction registered BEFORE running: A > B reasoning tokens on 2+/3 items AND SV in A only — else forecast fails and premise re-opens.

---

## Q5 — 3FS vs Engram (two layers, kept apart)

- (a) 3FS — **Documented** (https://github.com/deepseek-ai/3FS/blob/main/README.md): disaggregated RDMA+SSD filesystem; KVCache-for-Inference section (decoder key/value offload, 40 GiB/s peak). Any README link to prefix caching or byte-stable prompts: **Unknown**. Our implication is **Inferred**: IF serving uses 3FS-backed KV cache with prefix matching, byte-stable prefixes raise hit rate — plausible, no vendor sentence.
- (b) Engram — **Documented what it is** (https://github.com/deepseek-ai/Engram; https://arxiv.org/abs/2601.07372): Conditional Memory via Scalable Lookup, in-model O(1) N-gram lookup complementing MoE; experimental Engram-27B. Exact-name-as-key compatible with deterministic N-gram addressing — **Inferred** mechanism, untested effect. Ships in V4?: **Unknown** — no disclosure; speculation excluded.

---

## Q6 — Native multimodality and code (primary sources)

- **Documented**: Qwen2-VL (https://arxiv.org/abs/2409.12191) — 1.4T tokens incl. OCR + UI-screenshot trajectories; DocVQA 96.5 / OCRBench 877. Qwen2.5-VL (https://arxiv.org/abs/2502.13923v1) — ~4.1T tokens, Document Omni-Parsing, 1M chart + 6M table samples. Chameleon (https://arxiv.org/abs/2405.09818) — early-fusion, 9.2T seen; text-only beats Llama-2; stated image-tokenizer limit on text-heavy images. Isolated screenshot-ablation on code scores: **Unknown** in all three.
- Our models — **Documented**: Muse Spark 1.3 natively multimodal (https://dev.meta.ai/models/muse-spark); Claude Fable vision-input supported (natively-multimodal not claimed — verdict kept); LongCat 2.5-Preview vendor-claimed multimodal (https://longcat.ai/; OpenRouter/HF 2.5 entry absent — **Unknown** there).

### Measurement design M2 (designed, NOT run; no keys, no paid calls)

- Task: table-driven refactor (6x4 table, checksum-guarded) + indentation-sensitive Python edit.
- Condition T: spec as markdown/code fences. Condition I: SAME spec rendered to PNG.
- Models: vision-capable free models among Muse Spark 1.3 / Fable / LongCat 2.5.
- Rubric (binary/item): guarded cells/lines exact; indent columns byte-equal; no extra prose in artifact. Oracle = artifact bytes, not a judge model.
- Confounders: resolution/font, image-token cost, OCR-vs-sight routing. Prediction first: I >= T on table, T >= I on indent — else forecast fails.

---

## Q7 — Synthesis

### Activator → corpus presence → expected strength

| activator (kernel spelling) | corpus presence (documented) | expected strength |
|---|---|---|
| arXiv / arXiv_CS | Pile 8.96%, RP-v1 28B, peS2o/S2ORC core, Dolma-v1.7 28B; FineWeb-Edu down-weights arXiv-like | strong (documented) |
| PubMed / CochraneLibrary / MEDLINE | Pile PMC 14.40% + abstracts 3.07%; peS2o/S2ORC biomed; Edu clinical scoring unknown | strong PubMed (documented); CochraneLibrary-as-word inferred |
| PubChem / NIST_WebBook / GenBank / FAO / FRED / NBER / ICPSR | no dedicated slice anywhere; incidental CC only | weak (inferred) |
| USGS_Pubs / GeoRef / INSPEC / Compendex / Reaxys / eHRAF | no slice; Reaxys/eHRAF paywalled, by reference at best | weak (inferred) |
| HeinOnline / Westlaw / LexisNexis | FreeLaw 6.12% is courts, NOT Westlaw/HeinOnline; paywalled | weak (documented gap) |
| JSTOR / HathiTrust / PsycINFO / ERIC | no slice; PhilPapers 0.38% only philosophy home | weak (inferred) |
| IEEEXplore / ACM_DL / EngineeringVillage | no dedicated slice; CS via arXiv+code | medium (inferred) |
| code idiom; FSM/gate words | Pile 7.59% + SE 5.13%; Stack v1/v2; Dolma-Stack 411B; OpenFst anchor | strong (documented) |
| falsifier / LEAN / L1-medoids / JIDOKA / KAIZEN / reward-R / ledgers / gates | RL/RLHF arXiv dense; PhilPapers 0.38%; FSM-in-code strong; exact strings rare | medium (inferred) |
| PEP-8 / gofmt / style names | code + StackExchange Q&A at scale | strong (documented genre) |
| Popper | absent from kernel AND no slice | n/a — correctly absent |

### Consequences for the pending name-vs-paraphrase experiment

1. Stratify: strong-name arm (arXiv, PubMed, Cochrane, falsifier, JIDOKA, gates) vs weak-name arm (Westlaw, eHRAF, NIST_WebBook, FRED).
2. M1 (reasoning tokens + SV block) runs first; SV-emission marker field-observed once — one replication with counts beats ten anecdotes.
3. Engram-as-mechanism stays **Unknown**: compatible, undisclosed, untested.

### Claim verdicts (mine)

- C1 holds: every Q1 name carries a source.py/addons.py pin.
- C2 holds: every Documented row cites its paper/card.
- C3 holds: no model training-data attribution beyond its report.
- C4 holds: M1/M2 need no keys, no paid calls.
- C5 holds: 3FS and Engram reported separately.

### Receipts / untried

- Done: 13 researcher probes (11 green, 2 transient-undefined retried narrow to green); Q1 reads; REPORT.md + SOURCES.md; _progress_log.md entry; _build.ps1 run 20261016T013057Z_0902c70f.
- Untried: M1/M2 execution (by design — owner go needed); hash re-fetch of researcher stamps; ROOTS 46-language roster; per-domain FineWeb-Edu scoring; prompt-override precedence on DeepSeek/Qwen/GLM APIs; Engram-in-V4 disclosure watch.

---

## Source hashes (сняты Smit, 2026-10-16, curl byte-exact + sha256)

Запуски: `20261016T014423Z_b385fea6` (позиции 1–20), `20261016T014555Z_23f26769` (21–42). Оба exit 0. Метод — в `.temp/t50hash/fetch1.ps1` / `fetch2.ps1` (throwaway, не коммитится).

| # | URL | sha256 | bytes |
|---|---|---|---|
| 1 | arxiv.org/html/2101.00027v1 (Pile) | 20EE7797188FA9E55D6AC377A5E76584C1384320EBA9A504490ABFC7A7F6C6EA | 727986 |
| 2 | arxiv.org/html/2411.12372v1 (RedPajama) | 5764E9814E6B4F1B72D4B6FCFE52413CDC8B7635BA272DEE85BC99CD2A085E7A | 498786 |
| 3 | HF RedPajama-Data-1T (card) | E9EC149A0A5A5D24BB33E65A86F6217C448F7769764B89D27AAB433149C3105F | 152561 |
| 4 | arxiv.org/html/2402.00159v2 (Dolma) | F83558DDD44340A2669B91CAF567BA9CC527240CBFA95AF9E99222B6F11F8A16 | 703512 |
| 5 | HF allenai/dolma (card) | F8F169B1FD1FD9287231AF99458ECF10812F001E62F81BFB84FA0943239317BF | 167202 |
| 6 | arxiv.org/html/2406.17557v1 (FineWeb) | 6A84CD4B15451315A413ED80BCD2D19C79F7B6C524D2A9C223EE74568C36C3C8 | 245006 |
| 7 | HF fineweb-edu (card) | C91916163B48B06D809D681E29BC6CAF6664559B6B0A06FFC83668281BDFCE7B | 1418144 |
| 8 | arxiv.org/html/2104.08758v1 (C4) | 503DB4C150B94DB641ADB2DEC8DD81D6A9A3C2970C17F268DC8CD5D5F439FC98 | 144473 |
| 9 | arxiv.org/html/2306.01116v1 (RefinedWeb) | 1FA0960A98446D0CE6F34ABC4C6BC4AEA5D8C0B2192C2D5BF06BB5B312AD9D4E | 473060 |
| 10 | arxiv.org/html/2402.19173v1 (Stack v2) | 32BAE05361B2A635CD22EB727DE404DB061048AE88E2E60D308BD0C4BA9D4D90 | 832390 |
| 11 | arxiv.org/abs/2211.15533 (Stack v1) | 07224922A7EFCC52D808A17AA8C7614677137AC3DAD631DF12B04D6DF7A89DFC | 43348 |
| 12 | github.com/allenai/peS2o | 4CBB92A49B793324308F4AA93EDB245020DB6BB637A7520EDB4C00C41BB60874 | 294426 |
| 13 | aclanthology.org/2020.acl-main.447 (S2ORC) | B0F4BC5097492783A59B3DACCEA6E3718C331785312ECE6FCE832D388C64FC8D | 40953 |
| 14 | arxiv.org/abs/2303.03915 (ROOTS) | 6D2C8ECFC2E76418E19C0F333CECD8D741ED387004EA6F170FA7270AAE0E7BE1 | 49677 |
| 15 | arxiv.org/html/2307.09288v2 (Llama 2) | C72A08D375F5EEDD188495AFA48921323CC4F3F76804676D2F71D771DEDBFE3A | 1071783 |
| 16 | arxiv.org/html/2407.21783v3 (Llama 3) | 089F2657A67C2E558B1338F203606FFB323A2ECEBC021E170C0475E1F3BC8E46 | 1072480 |
| 17 | arxiv.org/html/2402.00838v4 (OLMo) | 354234008705BA8A0D504038D1939AD399B2E3A9C52AF0E96677B8BCA6EC69A8 | 290340 |
| 18 | arxiv.org/html/2412.19437v2 (DeepSeek V3) | A1602D6EA080FB0176BEEFDE2BBF7DE785224E05149A870C79892D251B35C0E0 | 550184 |
| 19 | arxiv.org/html/2501.12948v1 (DeepSeek R1) | 1D82CC976356FE64E258126DFBDAA09E40DBD1ECCDB4B709783DF960373264BD | 225324 |
| 20 | arxiv.org/html/2407.10671v1 (Qwen2) | ED84C1A5EB2CC09EEC08533FD522611D4F9D90DD618EDBB5BAE1CE4D8DCB98C9 | 335051 |
| 21 | arxiv.org/html/2505.09388v1 (Qwen3) | CF5C79D6F4795F74228EBBC7C8BE8872BF1FDB03C5A7C856A89CDE915691F0D7 | 986155 |
| 22 | arxiv.org/abs/2406.12793 (GLM-4) | 89C32D9E4B4594B497C433183E88E33881F8C203CF8868D43604F68C894DD444 | 52178 |
| 23 | arxiv.org/abs/1707.06347 (PPO) | 3A19E2FE2F2886EAACCF759093F7A0EADEFD632A33D824FF83B86BA8EB01C114 | 42489 |
| 24 | arxiv.org/abs/2203.02155 (InstructGPT) | 44041210F5BFD20233118B305160785F14161F1CF026FF6EFA372E3B3F30B7C4 | 44863 |
| 25 | arxiv.org/abs/2312.14925 (RLHF survey) | A6BF9E731F71FEC76C66549B4A5F0FC65F116B0A77A732AA2E686DB1C0182AB5 | 43433 |
| 26 | github.com/google-research/openfst | CB6546F3108F7D1D200CA45D272B190CF481F1F8AAD04B0FE44C7EACF83F145E | 363293 |
| 27 | HF deepseek-ai/DeepSeek-V3.1 | 0F2E48252B2DE37FCBBEA836519A51719E1D6AF63E2C2FC5C176D85A3F66FAAE | 299169 |
| 28 | api-docs.deepseek.com/guides/thinking_mode | 35350389E59872D3733F7B7F99F5485C6CBC95F1BC2A71A47BA3ECF30BD7A060 | 113722 |
| 29 | HF Qwen/Qwen3-32B | F6737EF926A89E982E7BC75CC14FE2B874F1CE51D3FB20EE75126AA6FAD8D6B7 | 346755 |
| 30 | alibabacloud deep-thinking | EE5FC04C208EB5C93FAF49958934347020CA3558E93D2A0082C61B7C9B439425 | 142239 |
| 31 | docs.z.ai thinking-mode | 57E4BDC272FD24FB9B59B826B063EB6ED5141F88B9C54F2E11D8D04181DE73EE | 337938 |
| 32 | platform.claude.com thinking-steering | 5349FCD792C58AE979A1EA7FAECD012E58182A663A0F391C4FB715685C92F5BA | 1084219 |
| 33 | github.com/deepseek-ai/Engram | F72AC6FB4EBCD20E854A774B430F8AC6599DF7B811EE77C25593867F44DED48B | 283635 |
| 34 | arxiv.org/abs/2601.07372 (Engram) | 537D8D0C72FF44646744F481B77D0AB4617F50554BF5E57B741C017C0132CF08 | 45584 |
| 35 | github deepseek-ai/3FS README | 170A3AA9A32EB506CC7B5E020ECC2118E08AAAB03A0783FEB8216CA3FD26D017 | 280802 |
| 36 | arxiv.org/abs/2409.12191 (Qwen2-VL) | 39838A433E02C068200F260A9FA025523FE5B204931B47DC2AC3870EB3138614 | 45096 |
| 37 | arxiv.org/abs/2502.13923v1 (Qwen2.5-VL) | BF47A28260C0EF6567236455071982A2A8AE29985386F50965CBF1F92A19C8AB | 46400 |
| 38 | arxiv.org/abs/2405.09818 (Chameleon) | E5DC80D20ED6C59CFB4766CECDD922989804E60DF9686D4C23663B1D7FA51FF6 | 41018 |
| 39 | dev.meta.ai/models/muse-spark | 5F1426458982E3E01E673B9E773235EBD045D55DCA469C1265D29CE25A06F60A | 516070 |
| 40 | platform.claude.com/models/overview | 543CA5A3070DDA781A8832467201F3B1F16DDA96A17E0E66E8739EE538D33EFC | 383677 |
| 41 | longcat.ai | 40D7CF93DAC1BC57BDD41F8B05BD66A48317A656CDF5928995F6DA004F25F4F2 | 4315 |
| 42 | ar5iv 2101.00027 (PhilPapers §2.19) | C382B5DD7542867FBE94FCCE4B823D3C0BF892B7B7F546C213D8C0EE41782B78 | 677121 |

Итог ступени: 42/42 страницы со свежими source_stamp (sha256 + bytes, сняты 2026-10-16) — понижать до Hypothetical нечего: все Documented-строки, на которых стоят выводы Q7 (Pile Table 1, RedPajama, Dolma, FineWeb-Edu, Stack, Q4-доки), покрыты свежими хэшами № 1, 2, 4, 7, 10, 27, 28, 29, 30, 31, 32.