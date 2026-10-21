<!-- intention: agent sees its own previous-message error and cannot remove it, window copies it forward by attention -> agent emits bounded self-edit directive (cut ranges + errata) addressed by message md5, stored original untouched, replay narrowed; error stopped at next step -->
<!-- goal_sv: self-edit-directive,reasoning-hygiene,error-recurrence,fault-tolerance,keep-machinery -->
# t70 — Self-edit directive: the agent cuts its own previous message inline

State: **ACTIVE** — run `ses_ebcd19477ffeW4K3YSKHoghqLB` (t70, owner launch 2026-10-16). Phase E only (offline experiment, no product code). Parent: `plans/2026-10-16_reasoning-lossless-replay.md` (t65 — reasoning is preserved first; you can only choose to cut what was kept). This plan DEPENDS on its A1; it does not edit its boxes.

```yaml
Keywords: self-edit-directive 0.35, reasoning-hygiene 0.25, error-recurrence 0.20, fault-tolerance 0.12, keep-machinery 0.08
Semantic dominant: Let the agent cut its own previous message inline by directive, original stored untouched.
md5: 7f3a9c1e4b5d6a708192a3b4c5d6e7f
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 6e41b38c90ad4a5f8732d697e0bc512a
```

## Owner verbatims (testimony, not proof)

1. «И вот еще у нас есть проет по возвращению reasoning content, в начале каждого сдедующего сообщения агент пишет какие строки из предыдущего оставить, иными словами пусть агент решает что реазать из reasoning и результата который останется, а что нет. Просто список диапазонов строк. Это не будет доп запросом - это скорее корректирующий элемент который срезает кусок предыдущего сообщения и добавляет следующее, тогда агент сможет на лету убирать то что не надо и добавлять коррективы. Какие строки убрать, и после такой то линии добавить такой коммент, после такой-то такой. Для этого нужен формат - мы вставляем md5 после каждого сообщения. Тогда: `<message_md5>....................</message_md5>` и все. Окно не захламляется, да и модель после генерации всегда знает чего вышло не так.»
2. «Это может стать сильнейшим механизмом для поддержания чистоты DNA и личной эволюции. Также очень серьезно повысить отказоустойчивость системы в целом.»
3. «реально на эту тему дипсик сильно убивается, он видит что трансформер подцепил ошибку и генерит ее в следущем сообщении - рад бы удалить - но как?»
4. «Пусть у всех будет, reasoning подписан или нет, после возврата - это тоже сообщение и что из него оставить - реашает модель.»
5. «Конечно - ты че - это очень серьезная тема, ее надо протестировать вдоль в впоперек предже чем ставить стандартом.»
6. «ты ищеш данные по процедуре - сделал одновременно 10 запросов, один из них результативен и ты это знаешь - ты оставляешь только от что тебе надо и все. Таким образом твое окно не раздувается. Да у нас есть и recall и прочее. Но это банальная тактика или ты сделал запрос в codegraph, узнал что там из полотна codegraph тебе пригодилось несколько элементов, тебе бы это удалиь и оставить только то что надо - но как?»
7. «Изначально мы же работаем с неопределенностью - ну и кушаем мусор - куда без этого.»
8. AGENTS.md Continuity rule 4 (commit `bbd76ba319`, DECIDED): «Агент должен иметь возможность исправлять обнаруженные дефекты собственного рабочего представления до их повторного использования, не изменяя первоисточников, доказательств и истории решений.»

Framing (Claude): the working window is the agent's DNA — a wrong hypothesis left in it is copied forward by attention into every later turn. The directive is proofreading at replication time (as a polymerase removes the base it has just added — one step back, never a cascade), which is why «only the previous message» is the right scope. Fault tolerance = an error stopped at the next step instead of propagating.

## SVM / strategy / source surface

SVM: task=`self-edit-directive-20261016`; parent=`reasoning-lossless-replay-20261016` (t65 A1); goal_hierarchy=MASTER_PLAN mechanical continuity → reasoning preservation (t65) → self-edit directive (t70). goal_vector=this plan + acceptance frame below; task_vector=E1–E6 then P1/P2; evidence_vector=graph/source pins, run addresses; oracle_vector=pending. Per-task SVM materialised with the state tool before implementation slices; plan text is not the store.

PLAN_STRATEGY: [MASTER_PLAN.md](MASTER_PLAN.md), Goal level0: mechanical continuity / proof-not-claim / turn-loop-first. Contribution: the window holds what the CURRENT task needs — the agent itself narrows its own previous message (reasoning + results) before it is recopied, on top of the keep machinery it reuses, never beside it.

STRUCTURAL_EVIDENCE (G1, re-read from disk this run):
- Keep machinery (REUSE, not a second mechanism): `packages/opencode/src/tool/recall.ts` (`readToolResult`, `parseRange`, `parseChars`, `sliceResult`, `keep`/`release` with required reason; `keep` refused for attachments; never-blank guards) — full source read this run.
- Addressing precedent: `packages/opencode/src/session/message-v2.ts` (`addressableLines`, `selectLines`, `READ_ROW` 8-hex hash dialect + legacy, `EVIDENCE_HEADER`/footer dropped not numbered, wrap rejoin) — read this run.
- Replay path: `toModelMessagesEffect`/`toModelMessages` (`message-v2.ts:1275,1831`), `provider/transform.ts` (`normalizeMessages`, `hasOpaqueReasoning`, DeepSeek/MIMO 400-guard `reasoning_content`, interleaved dialect, openai-compatible no-echo strip), `provider/sdk/copilot/chat/convert-to-openai-compatible-chat-messages.ts:130-154` (metadata `reasoning_content` fallback to parts text), `session/processor.ts:257` (`finalizeReasoning`), `session/llm.ts` (call path — bind in P1).
- Store shape: `.opencode/data/opencode.db` read-only this phase — `part` rows by type: tool 37239 / 250 MB, reasoning 18749 / 76 MB, text 14305 / 44 MB; top-30 reasoning parts 64 KB–244 KB each (measured this run). 30-message Phase-E corpus drawn from there.
- Continuity invariant: AGENTS.md § Continuity Paradigm rules 1–4 (rule 4 is the DECIDED tail-rule answer — design and test against it, § Constraints-1).

## Constraints the design must answer (each with its test)

1. **Tail rule.** Rule 1 forbids the RUNTIME silently compressing the tail; rule 4 permits the AGENT's own explicit, reasoned correction (cut or erratum) of what replays, before reuse. ERRATUM keeps the chain and adds the correction; CUT removes text from what replays. Both allowed ONLY on the replayed REPRESENTATION; stored original, tool exchanges (both halves), evidence and decision history never change. Test: representation-vs-source divergence probe — original bytes + tool call/result halves byte-identical before/after; replay shows cut/erratum with reason and address.
2. **Original is evidence.** Stored message never changes; directive + result are a representation with the agent's reason, reversible, addressable by `<message_md5>` (a REAL content hash of the stored message, not the SV label-md5). Test: hash-mint fixture — md5(message bytes) stable, directive names it, re-`recall`/re-read returns every byte.
3. **Every provider, signed or not — the model decides.** Directive applies uniformly. One known wire constraint (Inferred, verify in P1): Anthropic/Bedrock check the signature of thinking blocks the API requires back — reportedly the last assistant turn inside an active tool-use loop — so a modified signed block there is a 400, while thinking of EARLIER turns may be omitted. Do not decide from memory: fetch official docs (hash them) + capture installed SDK outgoing body (t65 capture route). Then implement the owner's rule with the SMALLEST measured deviation (e.g. inside an active loop the original signed block goes on wire unchanged, cut/erratum takes effect at next turn boundary where omission is legal), report deviation + receipt to owner (@INTENTION_INVARIANCE). No fake/re-signed blocks. Test: per-provider signed/unsigned matrix with 400/accept receipts.
4. **Addressing.** Models count lines badly in long text. Measure BEFORE choosing: (a) line numbers vs (b) quoted start/end snippets resolved by runtime (unique match or refuse) vs (c) short per-line hashes (as `edit` uses). Pick by measured accuracy, not taste. Test: Phase E (a) — same 30 messages × 3 schemes, accuracy = exact intended-span reproduction.
5. **Bounded scope.** Only the immediately previous message (owner's words) — one bounded KV recompute, never a cascade through older turns. Test: recompute-bound probe — directive touches N-1 only; older turns' replay bytes unchanged; KV-prefix cost measured per directive.
6. **Never blank, never silent.** Malformed directive or range selecting nothing/everything is REFUSED and refusal is shown to the agent in its next turn; directive itself is stripped from what replays (window does not clutter) but stored. Test: adversarial fixtures — blank-all, empty-select, malformed, ambiguous (refused + visible); storage shows directive + refusal.
7. **Tool results in scope — through `recall` semantics.** Directive does inline, for MANY results at once, in the next message: per result id — keep these ranges / release the rest. Rules unchanged from content-lifecycle: CALL half always stays; kept result shows slice + address; released shows placeholder (`recall(id)` brings every byte back); never blank; `keep` refused for attachments; reason per entry. Released fruitless result is a NEGATIVE result and keeps ONE line in its placeholder — what was asked, that it gave nothing useful (the reason) — so no later turn or peer re-runs it (Provider Reach guard 4). Test: multi-result directive fixture — 10 parallel results narrowed in one directive; call halves intact; released placeholders carry the one-line negative result; `recall` restores bytes.

## Gate to standard — along and across before default

E (offline experiment, this brief) → P1 (product behind switch, OFF by default) → P2 (opt-in per model in t68 chain, real robot runs) → owner's decision → default. Each stage with own receipts; owner decides last step. Matrix P1/P2 covers, every cell with prediction first:
- **along** — long sessions: many consecutive directives, across fold/compaction, after restart, with t65 preserved reasoning, KV-prefix cost per directive;
- **across** — every provider route (signed: Anthropic, Bedrock; unsigned: DeepSeek, Muse, GLM, OpenAI-compatible, OpenRouter), every model the chain may hold;
- **adversarial** — model tries to remove a tool CALL, release result with no reason, cut receipt it later cites, blank whole message (refused, shown to it); malformed/ambiguous directives (refused); directive hiding its own mistake (original + self-refutation record stay);
- **effect** — ERROR RECURRENCE (A/B) + errata-caught-by-self vs by-peer (the measures justifying the standard);
- **rollback** — one switch OFF with no residue; originals never touched so off = exactly old behavior (proven by byte comparison of replay).

## Measures (Phase E seeds, P2 keeps)

- Errata per 100 turns per model; errors caught-self vs found-later-by-peer-or-owner (self-refutation count pays per @REWARD_FUNCTION).
- ERROR RECURRENCE (decisive): given turn N with known error, how often N+1 repeats it with error left in replay vs cut/annotated by directive (same model, same prompt, A/B; free/contributor unsigned-reasoning models; DeepSeek only if owner's balance allows — no paid calls without his yes).
- Tool-result waste: for real sessions, fraction of each heavy result (codegraph, grep, universalsearch, read) later actually used (cited path:line, edited hash, quoted text) vs what kept replaying — tokens a directive would have saved, per tool.

## Acceptance frame

| ID | Predicate | Oracle / discriminating control |
|---|---|---|
| A1 | Directive narrows previous-message replay (reasoning + many tool results) while stored original + tool exchanges stay byte-identical | Representation-vs-source divergence probe; EXPECTED_FAIL: mutating original |
| A2 | Addressing scheme chosen by measured accuracy; losers recorded with numbers | Phase E (a) 30×3 accuracy table |
| A3 | Token saving measured per tool; negative results keep one line | Phase E (b) waste fraction per tool |
| A4 | Errata catch real mistakes (hand-read sample); self-refutation counted | Phase E (c) hand-read verdicts |
| A5 | Signed providers: smallest measured deviation from uniform rule, reported with receipt; no fake blocks | Provider matrix 400/accept receipts (P1) |
| A6 | Adversarial + malformed directives refused and shown; rollback off = old bytes | Refusal fixtures + replay byte comparison (P1/P2) |
| A7 | ERROR RECURRENCE A/B shows cut/annotated replay repeats errors less | A/B run receipts (P2) |

## Tasks and bindings

- [x] **E1** — Freeze 30-message corpus (long reasoning, `part` ids + lengths + session/message ids) from `.opencode/data/opencode.db` READ-ONLY; record predictions (accuracy per scheme, tokens saved, errata hit rate) BEFORE runs. state=DONE;receipt=`experiments/2026-10-16_self-edit-directive/CORPUS.md`. <!-- sv: offline-corpus 0.45, predictions-first 0.35, read-only 0.20 -->
- [x] **E2** — Addressing accuracy: same 30 messages × 3 schemes (line numbers / quoted snippets / per-line hashes); free model (Muse/Go contributor, gemma free — no paid) emits directive; runtime resolves; accuracy = exact intended-span reproduction. state=DONE;receipt=`SCORES.json` (6 calls, session-default openrouter/auto-beta router, cost UNKNOWN — model was not named explicitly, see REPORT correction): a-ok 27/30, c-agree 21/27, b-agree 13/27. <!-- sv: addressing-accuracy 0.50, measured-choice 0.30, free-models 0.20 -->
- [x] **E3** — Token-saving + waste measure: per heavy result (codegraph, grep, universalsearch, read) fraction later actually used vs kept replaying; tokens a directive would save, per tool. state=DONE-partial;receipt=cut_frac median 0.156 over shown window (prediction missed, REPORT §4); per-tool used-vs-replayed stays Unknown — needs P2 citation instrumentation. <!-- sv: token-waste 0.45, per-tool-measure 0.35, negative-result 0.20 -->
- [x] **E4** — Errata quality: hand-read sample — do errata catch real mistakes? Count self-refutations. state=DONE;receipt=13/30 specific errata, 1 structurally verified, 0 generic (REPORT §6). <!-- sv: errata-quality 0.45, self-refutation 0.35, hand-read 0.20 -->
- [x] **E5** — Provider-constraint grounding (researcher): fetch+hash official Anthropic/Bedrock thinking-signature docs; capture installed SDK outgoing body (t65 route); state smallest-deviation rule for P1. No product code. state=DONE;receipt=researcher E5 (11 fetches + 3 searches, all hashes; REPORT §5). SDK body capture deferred to P1 with t65 route. <!-- sv: signed-wire 0.45, doc-evidence 0.35, minimal-deviation 0.20 -->
- [x] **E6** — Report `experiments/2026-10-16_self-edit-directive/REPORT.md` with numbers-vs-predictions, tail-rule decision, go/no-go for P1. state=DONE;receipt=REPORT.md: GO P1 conditional, NO-GO default; P1 starts ONLY on owner GO (not started). <!-- sv: experiment-report 0.45, go-no-go 0.35, owner-question 0.20 -->
- [x] **AB** — ERROR RECURRENCE A/B offline (chunk 1, owner «оба параллельно», A/B first): 10 real-error pairs × 2 arms, explicit `streamlake-vanchin/deepseek-v4-flash` (cost free), prediction frozen first. state=DONE;receipt=`experiments/2026-10-16_self-edit-directive/AB_REPORT.md`: A=2/10, B=0/10; claims fixed where reproduced, CJK needs long continuations (P2 correction). <!-- sv: error-recurrence 0.45, ab-measurement 0.35, explicit-model 0.20 -->
- [x] **P1a** — Tests first (must be RED before product edits): directive parse/validate — tag resolution, snippet unique-or-refuse, never-blank, tool-CALL-half untouchable, keep-refused-for-attachments, reason-required; signed-last-turn passthrough; rollback byte-equality. state=DONE;receipt=RED `20261016T072148Z_4b646459` exit 1 (no module) → GREEN `20261016T072438Z_d1636e58` 21/21 exit 0, `session/self-edit.ts` + `test/session/self-edit.test.ts`; typecheck red-inherited (before-run `20261016T072738Z_11bed74c` exit 2, same 2 processor.ts chain-switch errors without own files — t68 uncommitted); build `20261016T073012Z_bd7de6e5` exit 0, smoke 10.0.1391. <!-- sv: tests-first 0.45, refusal-fixtures 0.35, red-proof 0.20 -->
- [x] **P1b** — Product behind switch (default OFF): per-message content-md5 mint+store; directive parse/apply on the `message-v2.ts` replay path only (stored original untouched); tag-primary addressing, line numbers advisory; Continuity p.4; signed block verbatim on the last turn, model's decision effective at the next turn boundary; tool CALL never cut; released result keeps one negative line («что искали — пусто» + reason); directive stripped from replay but stored. state=DONE;receipt=`message-v2-self-edit.test.ts` 8/8 (RED 4/4 `20261016T080204Z_9d4d041e`), `self-edit.test.ts` 21/21, `message-v2.test.ts` 47/47, typecheck exit 0; build 2× exit 1 on foreign `dist\bin\opencode.exe` lock (smoke 10.0.1394/1395 PASS) — residual with lift condition; forbidden t68 files untouched. <!-- sv: product-switch 0.45, replay-path 0.35, rollback-proof 0.20 -->
- [x] **P1c** — Refusal surfacing + rollback proof: malformed/blank/call-removal/no-reason directives REFUSED and shown to the model next turn; switch OFF = old replay bytes exactly (byte comparison). state=DONE;receipt=`message-v2-self-edit.test.ts` 11/11 (RED 9/2 `20261016T083120Z_d9465f47` → GREEN `20261016T083430Z_f71c13f1`); refusal-note `[self-edit refused: reason]` replaces the block, tail survives, reportCut kind "directive refused"; rollback `OFF == ON-without-directive` byte-identical; P1b malformed/foreign tests superseded to note-expectations; build `20261016T083516Z_d14d810c` exit 0, smoke 10.0.1398. <!-- sv: refusal-visible 0.45, rollback-bytes 0.35, no-residue 0.20 -->
- [ ] **P2a** — Opt-in per model in the t68 chain, real robot runs: along/across/adversarial/effect cells incl. ERROR RECURRENCE A/B. Oracle: the A/B run pair this plan already records (ERROR RECURRENCE A=2/10, B=0/10 — commit `f11d74cef8`) extended to the four cells; every run logs model, prompt hash and output hash; free models only (no paid calls without the owner's yes).
- [ ] **P2b** — OWNER DECISION — the DEFAULT. The plan's own words: «Owner decides default last». Quote carried verbatim; the switch stays opt-in per model until the owner names the default. Resume: the owner names it — no robot may pick a default on the owner's behalf. <!-- sv: robot-runs 0.45, error-recurrence 0.35, owner-decision 0.20 -->

Allowed in Phase E: `plans/2026-10-16_self-edit-directive.md`, `experiments/2026-10-16_self-edit-directive/**`, `_progress_log.md` (own entry), read-only DB. Forbidden: `bin/`, kernel, product source edits, paid calls (>0 without owner yes), `git add -A`, bare `git commit`.

## Smoke Tests

Predictions recorded BEFORE runs (E1 freezes them):
- Addressing accuracy: line-numbers ~55%, quoted-snippets ~85%, per-line-hashes ~70% (models copy text better than they count; hashes are exact but long). Falsifier: any scheme under 40% or line-numbers best — re-examine corpus/task framing.
- Token saving: median cuttable ~60–75% of heavy-result bytes would save next-replay tokens; codegraph/grep most wasteful, read least (read windows are already bounded). Falsifier: median under 30% — directive not worth the wire.
- Errata: ≥30% of sampled directives catch a real mistake on hand-read (wrong hypothesis, stale plan, misread tool output). Falsifier: under 10% — erratum path is decoration.
- Refusal: 100% of blank-all / call-removal / no-reason-release fixtures refused in offline validator. Falsifier: any pass — validator is not a gate.
- Free calls ≤ 120 total; each run logged with model, prompt hash, output hash.

## Risks / rollback / continuation

R1: Directive becomes second keep mechanism drifting from `recall` semantics → REUSE: one selector (`selectLines`), one never-blank rule, one reason-carrying shape. R2: Model games cuts to hide mistakes → original + self-refutation record stay; hiding is refused. R3: Signed-wire 400 → smallest measured deviation, no fake blocks. R4: KV recompute cascade → scope is N-1 only, cost measured. R5: Shared tree (two robots, disjoint paths) → own paths only, private index commits.
Rollback: Phase E has no product change — nothing to roll back. P1 rollback = switch OFF + replay byte comparison (off = old bytes exactly).
Continuation: E → REPORT → owner go/no-go → P1 only on owner yes.

## Owner question (tail rule) — RESOLVED, no open question

DECIDED by owner (no open question remains): on the replayed REPRESENTATION both CUT and ERRATUM are allowed — AGENTS.md § Continuity rule 4 (commit `bbd76ba319`): «Агент должен иметь возможность исправлять обнаруженные дефекты собственного рабочего представления до их повторного использования, не изменяя первоисточников, доказательств и истории решений»; owner 2026-10-16: «пусть у всех будет, reasoning подписан или нет … что из него оставить — решает модель». Wire boundary from E5: a signed block on the last turn inside an active tool-use loop rides the wire unchanged, and the model's cut/erratum takes effect at the next turn boundary, where omission is legal (REPORT §5 with doc hashes). No fake or re-signed blocks, ever. P1 is NOT started — it waits for the owner's GO.

## Progress

- 2026-10-16: G1 grounded (keep machinery, replay path, addressing precedent, store shape, rule 4); plan file written; Phase E corpus + predictions next.
