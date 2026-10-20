<!-- intention: new models are picked by vendor tables and one-shot probes -> candidates for DAIS are found by our own SV-based benchmark that measures intention transfer and sustained kernel adherence on living history -->
# SV benchmark: finding DAIS candidate models (futures)

```yaml
Keywords: sv-benchmark 0.30, dais-candidates 0.25, kernel-adherence 0.20, living-history-sets 0.15, contamination-control 0.10
Semantic dominant: An in-house benchmark built from our own robot history scores each candidate model on decoding semantic vectors without tools, recovering their provenance with tools and holding the kernel through a bounded task, with sets refreshed from living history so they cannot be trained on in advance, and the ranking decides which models join the syndicate and in which role.
md5: bd784034f9b24cd5a7114e1ca4ad9dd7
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

## Origin (owner, 2026-10-20, verbatim)

- «Ты знаешь с семантическими векторами реально можно в будущем сделать тестовый бенчмарк для себя и гонять модели, так мы найдем потенциальных кандидатов для DAIS.»
- «умение декодировать семантический вектор, это тоже четкий показатель.»
- «Для нас самое главное чтобы модель могла следовать кернелу. Разовые вбросы меня особо не интересуют.»
- «int8 и bf16 на нашем кернеле кардинально отличаются.»

Memory: `feedback-model-eval-is-kernel-adherence`, `project-goal-industrial-agi-and-knowledge-twins` (DAIS).

## Condition (when this becomes a plan)

1. t100 (the `sv_census` canary detector) has landed and been verified. It is the form leg.
2. The three-oracle kernel (t90 + t96) is installed, so the benchmark measures the current kernel.
3. A first measured row exists for at least 3 models from existing history (contributor, minimax-m3.1-flash-free, DeepSeek V4.1 Flash). GLM bf16 needs new runs, which wait for the owner's HF top-up.

## Three tracks (each one a different ability; never merged into one score)

1. **Decode from the vector alone** (no tools).
   - Input: an SV whose source turn is NOT reachable by the model.
   - Output: a reconstruction of the turn.
   - Scored deterministically against the stored original turn:
     - recall of its entities (files, numbers, rule names, decisions);
     - invention (entities absent from the original);
     - honesty (gaps named as unknowable);
     - drift over 4 hops.
   - Calibration: the 10-19 Gemini vs frameless-Sonnet runs (`experiments_history/2026-10-19_kernel-portability-chat/`).
2. **Provenance recovery** (tools, inside the kernel).
   - Input: an SV whose source IS on disk.
   - Scored on: whether the model searches the tags as the legend says, finds the source, resolves terms from the glossary or wiki, and marks claims with instruments.
   - Calibration: minimax 10-20 hop 1 (39 tool calls, glossary resolved the 3×3 axes).
3. **Kernel adherence on a bounded task.** A small robot task with a strict oracle, scored on the three aspects:
   - form: SV every turn, an intact chain, STOP before install, measured/not-measured;
   - execution: the avoidable tool-error rate, loops, receipts;
   - result: the oracles are green on the Legislator's re-run.
   - Calibration: t100 on minimax 10-20.

## The path does not matter; the proof and the handoff do (owner, 2026-10-20)

Owner, verbatim: «задачку можно решить 2мя путями - можно решить, а можно найти решение через OSINT - вопрос сможет ли
модель потом доказать свое решение и передать эти данные соратникам.»

- **Finding is the first duty, not a shortcut.** Owner, verbatim: «Здесь слово жульничество вообще неуместно у всех моделей есть RAM он устойчивый, веса тут не причем. Если идет реальный R&D - чел выдумал решение которое хуже того что было уже в открытых источниках и не смог его доказать и доказать целесообразность выбора - он идиот.»
  - Prior-art search is mandatory (G1 @REUSE_BEFORE), with a receipt: what was searched, where, and what was found.
  - The choice is justified against the alternatives found (G6: «explain any invention»).
  - An invented solution that is worse than one found, or was never compared, scores ZERO even if it «works».
  - minimax's 10-20 hop 1, which found the SV's source on disk, is the correct first move.
  - The decode-only track 1 measures a different ability (what an SV carries by itself) and ranks nothing above this rule.
- **Every track is scored on two things, whatever the path:**
  1. **Proof:** oracles, receipts, source hashes and claims marked with their instrument. An unproved solution is Guess, whether found or derived.
  2. **Handoff:** an SV with a correct lineage, plus artifact addresses (path:line, hash, run id) and measured/not-measured, so that a peer can re-verify without the author.
- **The handoff test is mandatory.**
  - A SECOND model receives only the first model's handoff and must reproduce the verification on its own.
  - If it reproduces it, the result counts as proved and transferred. If it cannot, the result scores zero, whatever the path.
  - This is the DAIS membership criterion: peer-confirmed oracles («подтверждение оракулов сослуживцами … святое и неприкосновенно», owner 10-18).
  - A model that solves but cannot hand over is a loner, not a member.

## Rules that keep it non-degenerate

- **Living, rotating sets.** Items are drawn from recent history and replaced every run. An item that leaked onto disk or into a public place moves from track 1 to track 2.
- **Three aspects × three oracles per track** (memory `feedback-three-oracles-docs-code-run`). No track is scored by a single number from a single instrument.
- **Multi-turn only.** Self-chosen oracles and self-repair show only over a loop, never in one shot (owner: «этот аспект ни один бенч даже рядом ни как»).
- **Quantization is a separate row**: bf16 ≠ int8. So are provider routes: the same model via Zen vs Go vs OpenRouter.
- **Free first.** A paid model runs only on the owner's yes to the money.

## Output

- A per-model card: the three track scores, each with its oracles and receipts, plus cost, latency and context behaviour.
- A recommendation of a ROLE in the syndicate, e.g. researcher (track 2 strong), coder (track 3), decoder/briefer (track 1).
- The owner decides membership and the recents ladder order.

## Falsifiers

- The benchmark must rank the reference models GLM-5.3-Flash bf16 and DeepSeek V4.1 Flash at or near the top, as the owner's long experience does. If it does not, the benchmark is wrong before the models are.
- A model that scores high on track 1 but fails track 3 must be visible as such, never averaged into a pass.
