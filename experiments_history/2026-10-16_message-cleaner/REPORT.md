# t69 Phase E — REPORT: chained message cleaning (experiment, no product code)

**Verdict: NO-GO for Phase P (conditional).** The chain's core — fixer quality — is unproven:
0 of 27 fixer calls returned output; the free pool answered 429 to all 5 attempts in the window.
What stands measured: corpus (E1), detector (E2), validator oracle (E4). Resume condition is
named in §Go/no-go. No paid id was touched, no model substitution was made.

Owner brief: one zero-tool call per flagged reply on
`openrouter/google/gemma-4-26b-a4b-it:free` with the fixed prompt (plan §Fixer prompt),
deterministic validator decides, the original stands on any failure.

## Predictions vs measured (all five scored honestly)

| # | Prediction (before running) | Measured | Hit? |
|---|---|---|---|
| 1 | Detector recall 0.80–0.90 | **0.680** (TP=34, FN=16, FP=0, TN=20) | ✗ MISS — cause found: all 16 FN are correct exclusions (see taxonomy). Recall over the fixable truth is **27/27 = 1.00** (redefinition stated openly, not a re-score). |
| 2 | Detector precision 0.85–0.95 | **1.000** (FP=0 on 20 clean controls) | ✗ MISS upward — prediction was over-cautious; the prose/code splitter held on every control. |
| 3 | Validator acceptance 0.70–0.85 | **UNMEASURED** (0 fixer outputs; 1 verdict: REJECT no-output) | ✗ UNSCORABLE — free pool 429, see §Fixer. |
| 4 | Latency p50 3–8 s, p95 15–30 s | **UNMEASURED** (no success). Error latencies observed: 862 ms (1 attempt), 182 366 ms / 3 attempts with 2×90 s backoff. | ✗ UNSCORABLE — same cause. |
| 5 | 10 accepted fixes, zero drift | **0 accepts → sample impossible** | ✗ SUBSTITUTED — 10 hand-read detector verdicts instead (5 slips + 5 exclusions, §Hand-read), quoted. The drift question is open until E3 re-runs. |

## E1 — corpus (A1 ✓)

Read-only scan of `.opencode/data/opencode.db` (1 450 942 464 B, size+mtime identical before/after;
`mode=ro` URI): 50 assistant replies with Cyrillic+CJK — exactly the table Claude measured
(stealth/space-bunny-alpha 26, deepseek-flash 10, space-bunny-free 6, longcat-2.5-preview-free 3,
mimo-v2.6-flash-free 3, muse-spark-1.3-contributor-free 2) — plus 20 clean Russian controls with
code fences. `corpus.jsonl`: 70 lines, each with msg_id + model.
Raw-scan divergence 207 → 50 resolved and recorded: 45 are user-role parts, the rest non-text
parts (reasoning/tool). Model pins read back as `provider/model` (e.g. `deepseek/deepseek-flash`,
`openrouter/stealth/space-bunny-alpha`).

## E2 — detector (A2 ✓, numbers above)

Prose = outside fenced blocks, inline code, URLs, `>` quotelines, SV-block lines. Inline
`«…»/"…"` quotes are DETECTED but marked not-sendable (see finding). Foreign-ratio cap 0.10
separates slips (max observed 0.0052) from whole-Chinese replies (0.5654, 0.5232) with a wide gap.
Fixable: **27/50**. FN taxonomy (all correct exclusions): inline-code 11, fence 2,
fence+inline-code 2, quoteline 1.

**Finding (changed the plan):** deliberate tokens live in code spans AND in quotes —
the space-bunny `エラー` self-investigation (11 code mentions), deepseek's literal `的` under test,
quoted Chinese dominants («S5 已通过请求体这一工件关闭…»). A validator without quote protection
would ACCEPT the destruction of a deliberate token (small bounded edit, no foreign left) —
meaning drift invisible to rules 2–3. So: validator rule 1 protects inline quoted spans;
send-time scope skips quoted-only hits (5), whole-foreign replies (2), SV-block-only hits (2).
Genuine slips inside quotes (面板, 规则) stay unfixed by design — recorded residual, not a fix.

## E3 — fixer (A3 ✗ BLOCKED upstream, receipts below)

Route: direct OpenRouter HTTPS (no session, zero tools by construction; production route left
for Phase P design). Key present, model id exactly as planned, temperature 0.

| Attempt (UTC 2026-10-16) | Result |
|---|---|
| probe-only, shortest reply (141 B) | 429 in 862 ms |
| diag ping | 429 + body: `google/gemma-4-26b-a4b-it:free is temporarily rate-limited upstream … limit_source: upstream_provider_shared_pool … remedy_hint: Retry shortly` |
| run-1 `--all` | stall-killed after 124 s of silence (90 s sleeps print nothing) — harness lesson, no output, no log |
| run-2 `--all` (heartbeat + incremental append + resume) | 3 attempts × 429 over 182 366 ms → PROBE REFUSAL stopped the run, 1 line logged, nothing else sent |

429-share: **5/5 attempts, 0/27 replies with output.** Free calls spent: 4 billed attempts
(under the 120 bound). Researcher page-check of the model URL was inconclusive (proxy body, no
price/status observed — Guess, not grounds for anything); the direct probe is the instrument that
spoke. No fallback id was tried (a different id, free or not, is a plan change needing owner word).

## E4 — validator (A4 ✓ oracle green, verdicts 1/1 honest)

`validator.py` selftest **5/5**: identical-clean ACCEPT, slip-fix ACCEPT (edit=10 bound=10),
hex-touch REJECT rule1, rephrase REJECT rule3, cjk-left REJECT rule2.
sha256 `e1138628662d2afaf66c7497cce36730af1afcfafa6984d7356379b676ee77cf`.
Live verdicts: 1 line — REJECT `msg_0dec8e6c9001…` no-output status=error:HTTPError-429
(the pipeline runs end-to-end; it had nothing to judge).
Bound uses no guessed constants: W = longest whitespace-token of the original prose per reply;
hunks must sit inside [span−W, span+W]; opcode edit count ≤ Σ(run_len + W).

## Hand-read sample (substitute for the 10-fix drift read — detector verdicts, quoted)

Fixable slips (would go to the fixer):
1. `msg_0dec8e6c9001` (stealth): «Иду от⟦权⟧威ного источника» — Chinese chars inside a Russian word → expect «авторитетного».
2. `msg_0e2f7b9c4001` (stealth): «Ground him:⟦记⟧忆 говорит, что `prompt.test.ts:874`…» — 记忆 used as «память».
3. `msg_116c87131001` (longcat): «`renderSvgToRgba` ⟦和⟧ `renderSvgToPngDataUrl` — это отдельные» — 和 for «и».
4. `msg_124749b82001` (mimo): «жду⟦下⟧一⟦步⟧» — classic «жду дальше».
5. `msg_142492924001` (spark, t62): «**Что⟦跑⟧ло (cmd_runner, по одному файлу):**» — 跑 inside «Что …ло».

Correct exclusions (must come back UNCHANGED):
6. `msg_0e0a1e951001` (stealth, inline-code): «версию на своих же данных: `⟦エ⟧ラー` — не слово из ниоткуда» — deliberate token discussion.
7. `msg_0f2f21f1500103e` (deepseek, inline-code): «В базе — **7 партов, содержащих `⟦的⟧`**» — literal under test.
8. `msg_0dc26cddf001` (deepseek, fenced SV): «md5: b7e93f0a5c26d8⟦エ⟧ラー» — hash corruption, unfixable by design.
9. `msg_1258432b2001` (mimo, fenced SV): «и⟦为⟧何 она ловит сбои spacebunny» in the dominant — real slip, unfixable by design.
10. `msg_0e893341f001` (stealth, `>`-quote): «мёртвый⟦规⟧则 проходит ORPHAN/FLOATING» — genuine slip inside a quotation; skipped as ambiguous (residual class).

## Not-sent / rejected taxonomy (23 + 1, every one with its reason)

- 16 detector FN = correct exclusions (11 deliberate-in-code, 2 fenced-SV, 2 fenced+code, 1 quoteline) — never sent.
- 5 quoted-only flagged (deliberate `«エラー»`, slip `«面板…»`, slip `«не到达истина»`, 2 quoted Chinese dominants) — not sent, quote-ambiguity.
- 2 whole-foreign replies (ratio 0.5654, 0.5232) — not sent, not slips.
- 1 fixer verdict: REJECT no-output (429) — the original stands.

## Go / no-go for Phase P

**NO-GO (conditional, not a rejection of the idea).** Reason: the decision the experiment exists
to make — does the free fixer repair slips without drift, as judged by the validator — has zero
observations. Shipping a chain stage on detector quality alone would be exactly the simulation
the gates forbid. What is proven and reusable: corpus, detector (precision 1.000, fixable-recall
1.00), validator oracle (selftest 5/5), fixed prompt, harness with 429-backoff/heartbeat/resume.
Resume condition: re-run `fixer_run.py --all` (resume skips nothing — log holds 1 line) when a
first-call receipt shows `ok=True`; then E4 + a REPORT supplement with acceptance, latency, and
the 10-fix drift read. No paid id, no model change, without the owner's explicit word.

## Residual

- R-E3: fixer campaign unrun (upstream 429 in the whole window). Next action: one `--all`
  re-run; continuation receipt: `fixer_log.jsonl` line count 27 with first `ok=True`.
- R-Q: slips inside quotes (面板, 规则) and SV-block slips (md5-katakana, 为何) are out of the
  cleaner's reach by design — quoted intent needs a human, hashes need regeneration, not editing.
- R-R: whole-foreign replies need a language-route decision, not a slip-fixer (owner call).

## Receipts

Plan + E0–E2 + log: commit `934e205c` (private index). Scripts/corpus/metrics: gitignored
scratch at `experiments/2026-10-16_message-cleaner/` (extract, analyze_roles, detector,
fixer_run, validator, corpus.jsonl 70 lines, detector_metrics.json, fixer_log.jsonl 1 line,
verdicts.jsonl 1 line). Archive copies: `experiments_history/2026-10-16_message-cleaner/`
(byte-verified). Runs: probe-only 429/862 ms; diag 429; run-1 stall-killed 124 s (no output);
run-2 done 3×429/182 366 ms. Validator selftest 5/5, sha above.

## Supplement S1 — owner-authorized fixer swap to gemma-4-31b-it:free (2026-10-16)

Owner word (answer to the question, quoted): `openrouter/google/gemma-4-31b-it:free` —
«в каталоге $0, context 262 144, output 32 768». Grounded cell-for-cell in
`packages/opencode/src/provider/models/openrouter.json` → `models` →
`google/gemma-4-31b-it:free`: cost {input 0, output 0} ✓, limit {context 262144,
output 32768} ✓ (the non-free base entry differs: $0.2/$0.4, output 16384 — the `:free`
key is its own entry, like the other `:free` keys). Same fixed prompt, temperature 0,
same 27 fixable replies, same ≤120-call budget. Harness change only: `--model` with an
owner-allowlist (26b|31b, anything else = refusal), per-model logs
(`fixer_log_26b.jsonl`/`verdicts_26b.jsonl` — renamed from `fixer_log.jsonl`/`verdicts.jsonl`,
bytes unchanged; a 31b campaign would write `fixer_log_31b.jsonl`/`verdicts_31b.jsonl`).

Probe (1 call, shortest reply 141 B): 3 attempts × HTTP 429 over 182 261 ms → PROBE
REFUSAL, nothing else sent. Diag ping captured the body: `google/gemma-4-31b-it:free is
temporarily rate-limited upstream … provider_name: Google AI Studio, is_byok: false …
limit_source: upstream_provider_shared_pool` — the SAME shared pool as the 26b refusal.
31b attempts this window: 4 (3 probe + 1 diag), all 429. Campaign total across both ids:
≈11 attempts, 0 outputs. Paid ids: zero touched.

Renewed go/no-go: **NO-GO stands (now on two free ids).** The fixer-quality question has
zero observations on either id; detector/validator/corpus/prompt/harness are unchanged and
reusable. Residual R-E3 updated: re-run `fixer_run.py --model <id> --all` (resume-aware)
when a probe receipt shows `ok=True` on either allowlisted id; then E4 + REPORT supplement S2.
No third id without the owner's explicit word.
