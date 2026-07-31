# ADID 15.4.3 candidate ↔ opencode kernel alignment

**Sources**

| Artifact | Role |
|----------|------|
| `reasoning_candidate.txt` | Full ADID 15.4.3 essay (input) |
| `docs/adid_15_4_3/fragments/` | Split raw candidate (same style as `prompt/reasoning/`) |
| `docs/adid_15_4_3/fragments_improved/` | Kernel-aligned patches (fractal_only) |
| Runtime identity | `prompt/reasoning/*` + `algorithm_card.txt` + `opencode_prompts_kernel/` |

**Not for system prefix as a whole** — too large; skills/manager manuals must stay out of identity.

---

## Fragment map

| Fragment | Topic | vs kernel | Reuse / improve |
|----------|--------|-----------|-----------------|
| `00_front_meta` | Title, RFC 2119 | Meta only | Keep as doc header |
| `01_quick_reference` | Top rules, SVM-6, fractal when | **Conflict:** linear for clear goals | Use **improved/** version; optional plan-mode card |
| `02_flowcharts` | Mermaid InfoMark / SVM / fractal trigger | **Conflict:** linear branch | Use **improved/** fractal_only chart; InfoMark mermaid → docs/SPECS OK |
| `03_checklists` | Pre-task / pre-exec / post-exec | Strong overlap PRE_FLIGHT | Port bullets into plan SPECS / plans README if missing |
| `04_anti_patterns_mistakes` | Linear forbidden, Exact misuse | Aligned if “when triggered” fixed | Reuse table language; forbid linear always for 3+ steps |
| `05_communication_epistemics` | InfoMark ledger, SV, Δ, reverse search | High overlap with layer-1 + reasoning algorithms | **Improve** pocket with reverse-search Δ notes if thin; keep formulas in docs |
| `06_agi_kernel_fractal` | §15 fractal + k-medoids + batch modes | Body good; “two activation conditions” weak | **Primary reuse** for ALGORITHM_CARD; use **improved/** always-on process |
| `07_safety_fsm` | Certified FSM | Not in pocket protocol | Keep as `docs/` / safety SPECS only |
| `08_framework_principles` | §II bridge | Thin | Merge with 09 |
| `09_roles_governance` | Roles, SVM full, ADID workflow, manager contract | Partial (workflow steps) | Manager contract → docs/manager; 6-step loop ↔ PLANNING PRE_FLIGHT |
| `10_development_guidelines` | §III python guidelines | Partial CODING SPECS | Diff against CODING_AGENT_DIRECTIVES; pull deltas only |
| `11_operating_protocol` | §V | Thin | Optional |
| `12_web_search` | §VI | Overlaps REUSE / universalsearch | Prefer RUNTIME_RULES SEARCH/REUSE |
| `13_setup_appendices` | Setup, journals, glossary, history | Reference | Tag glossary useful for docs; not identity |

---

## Critical conflicts (must not load raw candidate)

1. **Mode 1 / linear for clear goals** in QR + mermaid (fragments 01–02).  
   Kernel: `linear_mode_1_forbidden` + ALGORITHM_CARD fractal-only.
2. **Fractal only after completion / 10+ msgs** (fragment 06 activation).  
   Kernel: geometry for all complex work; residual vs Goal SV.
3. **Size** — 72 KB essay vs ~12 KB reasoning pocket + SPECS dict.

---

## Recommended ports (incremental)

| Priority | Action |
|----------|--------|
| P0 | Keep runtime as-is (already fractal_only). Do not replace `reasoning.txt` with full candidate. |
| P1 | Adopt **improved** 01/02/06 as doc truth for ADID 15.4.3 in this repo. |
| P2 | Lift **checklists** (03) into `plans/README` or PLANNING acceptance if gaps. |
| P3 | Lift **InfoMark mermaid** into `docs/` (already conceptual in kernel). |
| P4 | Manager contract (09) stays docs — never system prefix. |
| P5 | Do not re-embed skills from any ADID dump. |

### Shipped into runtime (InfoMark + oracle)

| Item | Where |
|------|--------|
| Salience ≠ Evidence; mention never Exact | `02_info_mark.promote_information_mark` → Guess only; `salience_from_mention_ratio` |
| Canonical claim classifier | `classify_claim_status(...)` |
| Oracle PASS → Exact (scoped) | `status_after_oracle_pass(...)` |
| Pocket protocol | `reasoning/04_infomark_oracles.txt` + Gate 8 |
| RUNTIME terms/rules | `infomark`, `oracle`, `INFOMARK.SEP`, richer `VERIFY.OUTCOME` |

---

## Commands

```bash
# Re-split from reasoning_candidate.txt
python docs/adid_15_4_3/split_candidate.py

# Runtime reasoning (separate stack)
python packages/opencode/script/assemble_reasoning.py
python -m opencode_prompts_kernel --render-runtime packages/opencode/src/session/prompt/opencode_prompts_kernel.txt
```
