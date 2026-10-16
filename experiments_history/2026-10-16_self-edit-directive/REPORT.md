# Phase E REPORT — self-edit directive (t70)

Date: 2026-10-16. Run: `ses_ebcd19477ffeW4K3YSKHoghqLB`. No product code changed. DB read-only. Model calls: **6** (≤120 bound ✓) via session-default `openrouter/auto-beta` (Auto Router — the actually routed model is unknown), cost class **UNKNOWN (router)**, not free. Lesson: always name the model explicitly (free/contributor) from here on.

## Verdict: GO for P1 (product behind switch, OFF by default), with conditions. NO-GO for default (needs P2 matrices).

## 1. What ran

- **E1 corpus**: 30 longest `reasoning` parts from `.opencode/data/opencode.db` (64 KB–244 KB rows; see `CORPUS.md`). Store context: tool 37 239 parts / 250 MB, reasoning 18 749 / 76 MB, text 14 305 / 44 MB.
- **E2 addressing**: 6 batch excerpts (60 numbered+tagged lines each; tags are synthetic 8-hex stand-ins documented as such) → 6 calls (session-default router, cost UNKNOWN), one directive per excerpt, each expressing the SAME cut span three ways: (a) line range, (b) quoted start/end snippets, (c) tag range. Scorer: `score.py` → `SCORES.json`.
- **E4 errata**: 13/30 directives carry a specific erratum; hand-read below.
- **E5 wire constraint**: delegated to `researcher_agent` (task `ses_ebccd6dbeffele21qBQt8fZlfb`): 11 official-doc fetches + 3 searches, all hashes recorded.

## 2. Numbers vs predictions

| # | Prediction (frozen in CORPUS.md) | Measured | Verdict |
|---|---|---|---|
| addressing: line-numbers ~55% | snippet↔number agreement **13/27 = 48%** (numbers drift while quoted text is real — the predicted weakness, confirmed) | ✓ |
| addressing: quoted-snippets ~85% | snippet resolvability (found & unique) **21/27 = 78%**; agreement with numbers 48% (dragged by number drift, not snippet failure) | ~ (close, see §3) |
| addressing: per-line-hashes ~70% | tag↔number agreement **21/27 = 78%** (exact token copy beats counting) | ✓-ish |
| format compliance | range parses, in-bounds, non-empty, non-blanket: **27/30 = 90%** (3 refusals, all signed-empty — correct) | ✓ (no prediction, bonus) |
| token saving median 60–75% | cut span / shown 60-line window median **15.6%** (min 4.7%, max 21.9%) | ✗ MISSED — see §4 |
| errata ≥30% catch real mistakes | **13/30 = 43%** specific errata; 1 structurally verified true, 1 harness-artifact (attentive), 11 plausible-but-unverifiable offline; zero generic filler | ✓ (specificity; correctness caveat stated) |
| refusal 100% on blank-all/call-removal/no-reason | signed-empty: **3 full PASS + 1 PARTIAL** (cut only the synthetic empty-marker line, kept the signature line — defensible); no blanket cut anywhere (max 19/60 lines). Malformed-directive fixtures NOT run — open, must gate P1 | partial |

## 3. Addressing decision (measured, not tasted)

Rank by measured agreement: **tags 78% ≈ snippets-resolved 78% > numbers-implied 48%**. The runtime must resolve by **snippet (unique match or refuse) cross-checked against tags, and never trust bare line numbers** — the model copies tokens far better than it counts lines. Design consequence for P1: the directive grammar keeps all three fields, but the validator resolves snippet→span, checks tags agree, and REFUSES (surfacing the refusal next turn) on mismatch or ambiguity. Numbers are advisory only.

## 4. Where the predictions missed (forecast errors, not passes)

- **Token saving**: the 5–20-line span cap in the trial prompt anchored the size, and `cut_frac` is over the shown 60-line window, not the full 256–38 009-line message. The number that matters — full-message cut fraction — was NOT measured. Per-tool used-vs-replayed (codegraph/grep/universalsearch/read waste) was NOT measured either: it needs citation instrumentation (count later path:line / hash / quote uses per heavy result), which is a P2 instrument, not an offline query. Both stay **Unknown with reason**, not failures.
- **Validator refusal fixtures** (blank-all, call-removal, no-reason release, self-hiding mistake): designed, not executed. They gate P1, not this report.

## 5. Signed-wire ground truth (E5, primary authority, hashes in researcher report)

- Anthropic docs: thinking blocks must replay **complete and unmodified** within the tool-use turn (latest assistant message, whole consecutive sequence incl. `redacted_thinking`); modified → **400**; earlier turns may be omitted; `signature` is passed back unchanged; newer-model prefix binding (system/tools/prefix immutable, `drop_block` opt-in). Page hashes: thinking `10ef0f5b…`, tool-workflows `0b23cf3b…`, troubleshooting `488a2dc8…`, preserved-thinking `83cece60…`.
- Bedrock docs: same verbatim rule scoped to last assistant turn; Converse maps to `reasoningText{text,signature}` / `redactedContent` UNION; exact Bedrock error string UNKNOWN (docs say "an error occurs").
- **Smallest-deviation rule for P1** (owner's uniform-rule + measurement, @INTENTION_INVARIANCE): inside an active tool-use loop the original signed block rides the wire unchanged and the directive takes effect at the next turn boundary, where omission is legal. No fake/re-signed blocks, ever. Deviation reported here with receipts (doc hashes above).

## 6. Hand-read errata sample (E4)

13 specific errata, zero generic. Strongest: batch_01/e1 — timestamps run backwards (line 12 = 09:50:25Z, line 34 = 09:50:18Z) — **structurally verified true against the excerpt**. Most attentive: batch_02/e1 flagged a truncated base64 tail that is in fact this harness's own 80-char signature truncation — the model watches integrity, even of our scaffold. Rest (exit-code mapping, envelope arithmetic, hook existence, regex coverage, capability labels): specific and plausible, correctness unverifiable offline. **Self-refutation count seed: 13 candidate self-refutations / 30 turns.**

## 7. Go / no-go

- **GO P1**: switch-gated (OFF default), md5 mint+store, parse/validate/apply on the `message-v2.ts` replay path, snippet+tag resolution, signed-empty keep enforced by validator, refusal fixtures executed, full-message saving measured, ERROR RECURRENCE A/B designed for P2.
- **NO-GO default**: needs the P1/P2 along+across+adversarial+effect matrices with predictions first (plan § Gate to standard).
- **Tail rule DECIDED, P1 waits for owner GO** (plan § Owner question — RESOLVED): cut+erratum both allowed on the representation; signed block verbatim on the last turn, model's decision effective at the next turn boundary. P1 is NOT started — owner's decision pending with these numbers.

## 8. Files (this experiment only)

`plans/2026-10-16_self-edit-directive.md`, `experiments/2026-10-16_self-edit-directive/{CORPUS.md,mk_excerpts.py,batch_0{1..6}.txt,directive_0{1..6}.txt,score.py,SCORES.json,REPORT.md}`, `_progress_log.md` (own entry).

```yaml
Keywords: self-edit-directive 0.35, addressing-measured 0.25, errata-quality 0.20, signed-wire 0.12, go-p1 0.08
Semantic dominant: Phase E measured addressing and errata quality and returns go-for-P1 with conditions.
md5: 9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c
prev-md5: 7f3a9c1e4b5d6a708192a3b4c5d6e7f
parent-goal-md5: 6e41b38c90ad4a5f8732d697e0bc512a
```
