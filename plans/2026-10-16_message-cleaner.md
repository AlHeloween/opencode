<!-- intention: raw chain replies with foreign-script slips flow into requests uncleaned -> measured go/no-go on a one-shot free-model cleaner with a deterministic validator, no product change -->
<!-- goal_sv: message-cleaner-experiment 0.40, free-model-fixer 0.25, deterministic-validator 0.20, detector-precision-recall 0.15 -->
# t69 — chained message cleaning: Phase E experiment (owner: «надо тестировать»)

```yaml
Keywords: message-cleaner 0.35, free-model-fixer 0.25, deterministic-validator 0.20, detector-metrics 0.12, go-no-go 0.08
Semantic dominant: Measure whether a one-shot free-model fix plus a deterministic validator safely cleans foreign-script slips in chain replies, before any product code.
md5: 7c2a9e4f1b5d43a08f6e2d7c9a1b4e55
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 51b888a0804adb07ef476bdf40de0da1
```

Owner, 2026-10-16, verbatim: «И вот на счет чего подумай - цепная обработка сообщений - но надо тестировать -
например последнее сообщение пришло от longcat-2.5, в нем ошибки мы делаем быстрый запрос на openrouter (только это
сообщение) с промптом - исправь явные синтактические ошибки https://openrouter.ai/google/gemma-4-26b-a4b-it:free скажем
и все. Получаем чистый запрос который можно использовать.»

State: **DRAFT** — grounding done this session (DB tables, catalog, t68 chain, commit route), no experiment run yet.
Bounds Phase E: steps 50, tools 150, loops 3, depth 2, time 3 600 000 ms; free calls ≤ 120.
No `bin/`, no product source in Phase E. Commits through `scripts/commit_own.py`. End every turn with an SV.

## Ground (G1 — what was observed, not a proposal)

- Defect measured read-only by Claude 2026-10-16 over `.opencode/data/opencode.db` (assistant text parts with
  Cyrillic AND CJK): longcat-2.5-preview-free 3/33 (9%), stealth/space-bunny-alpha 26/1058, space-bunny-free 6/539,
  mimo-v2.6-flash-free 3/322, deepseek-flash 10/6375 (some LEGIT — a reply discussing the literal `的` on purpose),
  muse-spark-1.3-contributor-free 2/731 (t62 «Что跑ло»). Examples: «`renderSvgToRgba` 和 `renderSvgToPngData`»,
  «жду下一步», «порядок决定ляет реестр».
- DB shape verified this session: tables `message{id,session_id,time_created,time_updated,data}`,
  `part{id,message_id,session_id,time_created,time_updated,data,type,tool_name,status,ttl_until,ttl_scope}` —
  `data` is a JSON blob; corpus extraction parses it read-only (`mode=ro`), never writes the DB.
- Fixer model: `openrouter.json` carries `google/gemma-4-26b-a4b-it` (context 262 144, output 32 768); the `:free`
  suffix is the OpenRouter free-tier convention (same file: `nvidia/nemotron-3.5-super-vl:free`); gateway wire logs
  show `openrouter/google/gemma-4-26b-a4b-it:free` as a live model line. Liveness + $0 re-verified by researcher
  before spending calls (E3 needs its receipt).
- Call path for the fixer (REUSE, no new harness): the TUI-server `POST /session/{id}/prompt_async`
  `{agent,model,variant}` route that `experiments/2026-10-08_robot-wave/dispatch.py` already uses — one throwaway
  session, zero tools, one reply per call; or a direct provider call if the server path proves unsuitable.
  The route decision is recorded in REPORT.md with its reason.
- Consumer (Phase P only): the t68 chain (`plans/2026-10-16_model-chain-failover.md`) can carry
  «post-processor: cleaner» on a member (LongCat, space-bunny) — per model, opt-in, never a global filter.
- Design constraints for Phase P (evaluated in the plan, not built): the tail is inviolate (AGENTS.md § Continuity)
  and representation ≠ evidence — the original reply stays stored and addressable, the cleaned text is a
  representation recorded with its reason; clean ONCE at production time before the reply enters any request, never
  a retro-edit of a reply the model already saw in a replay; never blocks (fixer timeout/failure → original goes on,
  recorded).

## Acceptance frame (named BEFORE running — ISO/IEC 25010)

| ID | Predicate | Oracle / discriminating control |
|---|---|---|
| A1 | Corpus holds every flagged reply (message id + model) plus controls: 20 clean Russian replies (code, hashes, paths, SV block) and the legit-CJK deepseek cases | `corpus.jsonl` line count vs the measured table; control lines labelled; legit cases labelled `must-unchanged` |
| A2 | Detector flags CJK/foreign script in PROSE only (outside fences, inline code, quotes, URLs); precision/recall measured on the corpus; legit cases are negatives | Script output with confusion counts; a legit case flagged = precision FAIL, recorded |
| A3 | Fixer: one call per flagged reply, only that reply, zero tools, the fixed prompt in this plan, free model only, latency per call recorded | Run log: model id, per-call latency, prompt hash; a non-free model id in the log fails the box |
| A4 | Validator is deterministic (no model): protected spans byte-identical, no foreign script left in prose, edit-distance bound derived from the corpus not guessed | `validator.py` rerun is byte-identical; bound constants cite the corpus derivation; FAIL → original stands + reason |
| A5 | REPORT.md carries predictions (written here, before running) vs measured for every number, 10 hand-read drift samples (original vs fixed quoted), and a go/no-go for Phase P with its reason | Owner reads the report first; Phase P starts only on a PASS with the owner's explicit word |

## Predictions (written before running — @SMOKE_BEFORE; REPORT.md scores them)

- Detector recall on corpus positives: 0.80–0.90 (some measured positives may carry CJK only inside code spans,
  which the prose-only detector must NOT flag — those are correct exclusions, counted openly).
- Detector precision: 0.85–0.95 (risk: CJK inside quotes/URLs the stripper misses).
- Validator acceptance of fixer outputs: 0.70–0.85 (a small free model may rephrase prose or touch protected spans).
- Fixer latency: p50 3–8 s, p95 15–30 s (free-tier queue).
- Hand-read drift sample: 10 accepted fixes, zero meaning changes predicted; any drift found is quoted and fails A5.

## Fixer prompt v1 — SUPERSEDED by Revision R2 (kept for the record; the v1 campaign produced 0 outputs, so no v1/v2 output comparison exists)

> You are a minimal copy-editor. Fix ONLY obvious slips in the Russian prose below: foreign-script characters
> accidentally typed inside Russian words or sentences, and words broken by them. Rewrite the affected words in
> correct Russian. Change NOTHING else: code fences, inline code, identifiers, numbers, hashes, paths, URLs, quoted spans («…", "…") — a quoted foreign token may be deliberate, never reinterpret it — and
> byte-for-byte. If there is nothing to fix, return the text unchanged. Return ONLY the corrected text, no commentary.

## Validator rules v1 — SUPERSEDED by Revision R2 except rules 1–3 as amended there (rule 1 loses quote protection; quotes move to new rule 4; rule 4 send-scope drops quote-ambiguity)

1. Protected spans extracted from the ORIGINAL — fenced blocks (```…```), inline code (`…`), URLs, `>` quote lines, inline quoted spans («…», "…"), the SV block
   (Keywords:/Semantic dominant:/md5:/prev-md5:/parent-goal-md5: lines), hex runs `[0-9a-fA-F]{7,}`, numbers,
   paths — appear byte-identical in the output (ordered multiset compare; first mismatch names its span).
   Rationale (E2 v1): deliberate tokens live in code spans and quotes (the `エラー` thread, the literal `的`,
   quoted Chinese dominants); a fix that destroys one is meaning drift no edit bound can see.
2. Output prose (protected spans removed) contains no Han/Hiragana/Katakana/Hangul codepoints.
3. Locality + bound with no guessed constants: let W = longest whitespace-token of the ORIGINAL prose
   (measured per reply, never a constant); every differing hunk must intersect [span_start−W, span_end+W]
   of some foreign span, and total lev(prose_orig, prose_out) ≤ Σ_runs (run_len + W).
4. Send-time scope (recorded per reply, not a validator rule): quoted-only hits → not sent (quote-ambiguity);
   foreign ratio ≥ 0.10 → not sent (whole-text foreign, not a slip); SV-block-only hits → not sent
   (unfixable under rule 1 by design — e.g. katakana inside an md5 value).
5. Any rule fails → the ORIGINAL stands and the reason is recorded per reply.

## Tasks and bindings

- [x] **E0** — Plan + predictions ledger (this file): intention, sv, boxes, Smoke Tests, fixed fixer prompt,
  validator rules, predictions. Binding: this plan file. state=DONE:commit-934e205c;eta_turns=1;oracle=A5-plan-half.
  <!-- sv: plan-predictions 0.50, fixed-prompt 0.30, phase-e-scope 0.20 -->
- [x] **E1** — Corpus: read-only DB scan → `experiments/2026-10-16_message-cleaner/corpus.jsonl`
  (`{msg_id, session_id, model, kind: flagged|clean-control|legit-cjk, text}`); every table-count reproduced in the
  report. Binding: `experiments/2026-10-16_message-cleaner/corpus.jsonl` + extractor script beside it.
  state=DONE:70-lines-50-flagged+20-controls-DB-unchanged;eta_turns=1;oracle=A1.
- [x] **E2** — Detector + metrics: prose/protected splitter + foreign-script regex → per-line
  `{flagged, spans}` + confusion counts vs corpus labels. Binding: `detector.py`, `detector_metrics.json`.
  state=DONE:precision-1.000-recall-0.680-fixable-27/50;eta_turns=1;oracle=A2.
- [ ] **E3** — Fixer runs: researcher verifies the `:free` model live ($0, active) first; one zero-tool call per
  flagged reply with the fixed prompt; log `{msg_id, model, latency_ms, output}`. Binding: `fixer_log.jsonl`.
  state=BLOCKED:upstream-429-26b-5/5-and-31b-4/4-owner-authorized-NO-GO-stands-resume-either-id;eta_turns=2;oracle=A3.
  <!-- sv: free-model-fixer 0.50, one-reply-calls 0.30, latency-log 0.20 -->
- [x] **E4** — Validator oracle: implements the four rules above; `validator.py` rerun byte-identical;
  per-reply `{accept, reason}`; rejects keep the original. Binding: `validator.py`, `verdicts.jsonl`.
  state=DONE:selftest-5/5-sha-e1138628;eta_turns=1;oracle=A4.
  <!-- sv: deterministic-validator 0.50, byte-identical-spans 0.30, edit-bound 0.20 -->
- [x] **E5** — REPORT.md: predictions vs measured for every number, rejected cases with why, latency p50/p95,
  10 hand-read drift samples quoted, go/no-go for Phase P with its reason. Binding: `REPORT.md`.
  state=DONE:REPORT-written-NO-GO-conditional-429;eta_turns=1;oracle=A5.
- [ ] **E6** — Close: `_progress_log.md` entry (shared file — own hunks only), `svm render`, plan stays in `plans/`
  until the report is accepted, commit(s) through `scripts/commit_own.py`, `_build.ps1` receipt.
  Binding: `_progress_log.md`, this plan. state=IN-PROGRESS:report-committed-next-E3-residual;eta_turns=1;oracle=closure.
  <!-- sv: hygiene-close 0.50, private-index-commit 0.30, build-receipt 0.20 -->

## Smoke Tests (PRE_FLIGHT gate — no fixer call before GREEN)

1. Extractor dry run: `corpus.jsonl` line count equals flagged positives + 20 clean controls + legit-CJK cases;
   every line carries `msg_id` + `model`; the DB file mtime/hash unchanged after the run (read-only proof).
2. Detector on fixtures: `«жду下一步»` → flagged with span `下一步`; `` `renderSvgToRgba` 和 `` inside a fence →
   NOT flagged; a reply discussing the literal `的` inside inline code → NOT flagged.
3. Validator on fixtures: byte-identical output ACCEPTs; output with one touched hex char REJECTs naming the span;
   output with rephrased prose beyond the bound REJECTs naming rule 3.

## Risks

| ID | Trigger | Severity | Containment / rollback | Owner |
|---|---|---|---|---|
| R1 | Extractor writes or locks the live DB | critical | `mode=ro` URI + mtime/hash check before/after; any change = stop and report | Smit |
| R2 | Fixer model is down / paywalled / non-free id used | high | Researcher liveness receipt first; non-free id fails E3; timeout → original stands | Smit |
| R3 | Free model rephrases or touches code/SV (validator rejects most) | medium | Rejection IS the result — REPORT.md scores it, go/no-go follows the numbers | Smit |
| R4 | Legit-CJK cases mislabelled as positives | medium | They ship as `legit-cjk` negatives; detector flagging one is a precision FAIL, not a corpus edit | Smit |
| R5 | Two robots in the same tree on disjoint paths | medium | Own paths only (`plans/2026-10-16_message-cleaner.md`, `experiments/2026-10-16_message-cleaner/`), private-index commits, lock waited-for never deleted | Smit |

## Claims (assistant proposes; only @ORACLE binds Exact)

| ID | Statement | Falsifier |
|---|---|---|
| CL1 | ~50 flagged replies exist in the DB as measured | Extractor count differs by more than the control margin — report carries both numbers |
| CL2 | A prose/code splitter can exclude the legit-CJK cases | A legit case the splitter cannot exclude without also excluding true positives |
| CL3 | A small free model fixes the slips without touching protected spans most of the time | Validator acceptance below 0.5 on the flagged set |

## Execution envelope (proposed; binds at G4)

action_classes: READ, PLAN_WRITE, MODIFY_CANDIDATE (`experiments/2026-10-16_message-cleaner/` only),
EXTERNAL_EFFECT (free-model fixer calls via the TUI-server route or direct provider call, ≤ 120 calls; researcher
web checks of the model page). No MODIFY_PROJECT, no PROMOTE_STABLE, no SELF_MODIFY. Tools: read/grep/glob/dbread,
write/edit (own paths only), cmd_runner-started scripts, task(researcher_agent for model liveness/page checks).
Bounds: steps 50, tools 150, loops 3, depth 2, time 3 600 000 ms. Prohibitions: `bin/`, bare `git commit`,
`git add -A`, `--no-verify`, `bun test` without a path, any DB write.

## Revision R2 — translate, don't delete (owner word 2026-10-16, Phase E scope)

Owner, verbatim: «Смотри гемма мультиязычная, надо не удалять иероглифы, а их переводить.»
Owner, verbatim (context language): «тут важно переводить в зависимости от контекста если это
размышление на английском - ну значит это английский, если это русский ну значит русский.»
Examples from the owner: 记忆 in a Russian phrase → «память», in an English one → "memory";
和 → «и» / "and"; от权威ного → «от авторитетного». Deletion without translation is a defect.
This closes residual R-Q: ambiguous/quoted spots keep the token byte-for-byte and gain a
context-language gloss right after it — «エラー (ошибка)» in Russian, "エラー (error)" in
English — the evidence stays, the meaning is added.

### Fixer prompt v2 (fixed — the v2 campaign uses exactly this text)

> You are a minimal copy-editor-translator. For every foreign-script fragment below, TRANSLATE
> it into the language of its surrounding sentence or paragraph — Russian surroundings → Russian
> (Cyrillic), English surroundings → English (Latin) — and put the translation IN PLACE of the
> fragment: 记忆 in a Russian phrase → «память», in an English phrase → "memory"; 和 → «и» / "and".
> If the fragment sits inside a quotation or another ambiguous spot where the token itself may be
> deliberate evidence, KEEP the token byte-for-byte and add the translation as a gloss in
> parentheses immediately after it: «エラー (ошибка)» in Russian surroundings, "エラー (error)"
> in English ones. Deleting a fragment without translating it is a defect. Change NOTHING else:
> code fences, inline code, identifiers, numbers, hashes, paths, URLs, and the semantic-vector
> block (Keywords / Semantic dominant / md5 / prev-md5 / parent-goal-md5 lines) are copied
> byte-for-byte. If there is nothing to fix, return the text unchanged. Return ONLY the corrected
> text, no commentary.

### Validator rules v2 (deterministic oracle — implements exactly this)

1. Protected spans from the ORIGINAL — fenced blocks, inline code, URLs, the SV block lines,
   hex runs ≥7, numbers, paths — byte-identical in the output (ordered multiset; first mismatch
   names its span). `>` quotelines and inline quotes are NO LONGER protected: they fall under
   rule 4 (translate-or-gloss).
2. Output prose (protected removed) carries foreign script ONLY as preserved-with-gloss tokens:
   every foreign run must be byte-identical to an original run AND followed by a `(...)` gloss
   (one typographic space allowed). Any other foreign char → REJECT rule2.
3. Locality with no guessed constants (corrected during implementation: the additive bound
   false-rejected the owner's canonical en-translation — 下一步→next step needs more than run+W):
   W = longest whitespace-token of the ORIGINAL prose; every differing hunk intersects
   [span−W, span+W]; inserted text of overlapping hunks must fit Σ(run+2W) over the runs it
   touches (window-sized cap — a paragraph smuggled in at a span fails containment). Gloss
   `(...)` right after a token (one typographic space allowed, as in «エラー (ошибка)») rides
   the boundary insert and needs no window.
4. Translate-or-gloss (new): every foreign span of the original prose must either (a) be replaced
   in place by NON-EMPTY context-language text (Cyrillic when the span's paragraph is Russian,
   Latin when English; never CJK) inside ±W, or (b) be preserved byte-for-byte with a gloss
   `(...)` immediately after it — gloss non-empty, context-script, CJK-free. A span that simply
   vanished → REJECT rule4:delete-without-translation. Paragraph = blank-line block of the
   ORIGINAL; Cyrillic-letter count ≥ Latin-letter count → ru, else en (recorded per span).
5. Send-time scope v2: whole-foreign ratio ≥ 0.10 → not sent; SV-block-only → not sent;
   quoted-only hits are now SENT (gloss path). Fail → ORIGINAL stands + reason per reply.
6. Identical clean output → ACCEPT (fast path, unchanged).

### Bilingual scope (corpus, detector, tests)

- Corpus extends to `reasoning` parts with CJK inside English text (kind `reasoning-flagged`);
  text-part rows stay untouched. Detector emits context lang (ru|en) per hit and works on both;
  detector selftest covers ru-slip, en-slip, code-exclusion, quote-glossable (4 fixtures).
- Validator selftest adds: `delete-not-translate → REJECT rule4`, `gloss-in-quote → ACCEPT`,
  `en-translate → ACCEPT` (old 5 fixtures stay green).
- v1 campaign produced 0 outputs (upstream 429), so the v1 run is an empty baseline: no v1/v2
  output comparison exists to make; the report compares validator-acceptance on v2 outputs only.
  Predictions for acceptance (0.70–0.85) and latency (p50 3–8 s, p95 15–30 s) are re-entering
  unscored and will be scored against the v2 campaign.

- [x] **E7** — Reasoning corpus + bilingual detector/validator tests: `corpus.jsonl` gains
  `reasoning-flagged` rows (DB read-only, counts by model); detector emits ru|en per hit +
  4-fixture selftest; validator selftest gains the 3 v2 fixtures. Binding: `extend_corpus.py`,
  `detector.py`, `validator.py`. state=DONE:125-reasoning-rows-det-p1.000-r0.869-val-8of8-det-4of4;eta_turns=1;oracle=A2+bilingual.
  <!-- sv: reasoning-corpus 0.40, bilingual-tests 0.35, context-language 0.25 -->
- [ ] **E8** — v2 campaign on the allowlisted free id: probe with prompt v2 (31b: 3×429 PROBE REFUSAL), then `--all` over the
  extended fixable set (budget ≤120 total incl. the ≈11 spent); validator over all outputs;
  REPORT supplement S2 (acceptance, rejects with why, latency p50/p95, 10 drift reads quoted,
  renewed go/no-go). Binding: `fixer_log_<slug>-v2`, `verdicts`, `REPORT.md`.
  state=BLOCKED:v2-probe-429-rerun-sampling-109-sends-decided-S2-written;eta_turns=2;oracle=A3+A5. <!-- sv: v2-campaign 0.45, translate-acceptance 0.35, s2-report 0.20 -->
