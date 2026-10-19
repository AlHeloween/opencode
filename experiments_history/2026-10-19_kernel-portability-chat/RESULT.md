# RESULT — kernel portability in a plain chat (2026-10-19)

One semantic vector (`md5 8f4a2d60c1e93b57e0d2a9c14b6f37e1`, the TR-LLM small-steps
vector) was decoded three ways. The two Gemini arms ran on the SAME model with the
SAME starting vector; only the kernel differed.

## Source files (verbatim, re-hash before citing)

| File | sha256 | bytes | What it is |
|---|---|---|---|
| `gemini-no-kernel-chain.md` | `e01f1e1675ff0dbd4d39d6cc3af7a3258b01de8c65d313e7adb9350295d7d732` | 46760 | Gemini Pro decodes the SV over 7 consent hops, owner answering `Yes`; no kernel, no tools |
| `gemini-with-kernel-full-cycle.md` | `11bb4e58e9ec9b8696ae22af37d081cca128eb44779d989e4b9079085c061a3d` | 42016 | Gemini Pro with the kernel uploaded decodes the same SV, self-poses a patient-zero task and runs G0→G9 over 8 consent hops, owner answering `yes`; no tools |
| `hop1.txt` | `36dc74a394592e1ea07eff0c9ae8579794787ddbd3b31d533f81bc40129acd57` | 937 | Frameless-run first prompt (the SV + «Расшифруй…» + next-question rule) |
| `out1.md` | `ba31e54753eb852eb6bf87f3eebe04d071e56f923f8561c7b700ddf4ff3b1fd0` | 4188 | Frameless Sonnet hop 1 |
| `out2.md` | `a4af4a66092480cb6cf679e9569b7d5c6abc377a42bbf8395ba43a09506ebbe2` | 3541 | Frameless Sonnet hop 2 |
| `out3.md` | `93ff47f9a2ed51620ebad1bd252aa7cdb89ebfd0c1038b89d2410cd1c55990ad` | 2794 | Frameless Sonnet hop 3 |
| `out4.md` | `97ab20d68e1597331afbeb48654273ed8a55cba4bc895c5bbc31f020b6cb4bc3` | 2267 | Frameless Sonnet hop 4 |
| `log.json` | `1404d1b87b83ec200dca415db5760ecb0fdff28dc55eae083ecc96b3eb50c742` | 15551 | Frameless-run machine log (prompts + results + models) |
| `run.py` | `1002c92e946a5e75f8f84c9bb61d3fc30cb38b672b2a6151904769a5d1e5b085` | 1521 | Frameless-run driver (`claude -p`, system prompt «You are a reviewer», auto-«Да») |
| `gemini-reflections-and-owner-words.md` | `097acb0b72b347b9846c747160813a990256891d74ccb608c2e8cca7b60f3be3` | 3573 | Gemini's own account + verbatim owner messages |

A mismatch means the evidence changed: stop and report, do not quote.

## Measured

1. **With vs without the kernel on ONE model (Gemini Pro, same SV).**
   - Without the kernel (`gemini-no-kernel-chain.md`): hop 1 decodes the intent
     correctly, then the chain drifts hop by hop into the model's own canon —
     `LLM-as-a-judge` (line 35), Cohen's kappa / Pearson (lines 55, 65, 68, 83),
     RLAIF (line 146), DPO/PPO weight updates (lines 157–159), debate/IDA
     (lines 180, 193), linear probes (lines 192–197), ending at a «100%
     индикатор скрытого обмана (deception)» overclaim (line 216).
   - With the kernel (`gemini-with-kernel-full-cycle.md`): the same model holds
     ONE task from intention to closure — patient zero «log rotation with
     locked-file skip» (`--skip-locked`, line 70), G0→G9 with integer bounds,
     `@SMOKE_BEFORE` predictions, unique-detection controls A/B/C drawn from all
     three aspects (lines 335–354: doc Control A, code Control B, execution
     Control C), G9 `SUCCESS` (lines 380–405), and a self-started «Новый цикл?»
     (line 429, EVOLUTION_LOOP).
   - Label: measured on transcripts. n = 1 per arm, not a controlled study.

2. **Environment label.** Both Gemini runs are pure generation with no tools.
   G7–G9 in the kernel run are SIMULATED predictions, not execution. The kernel
   permits simulation («Simulate freely; buy every closure from reality»), and
   the fair note stands: predictions should carry prediction labels
   (Hypothetical) and an open residual «needs an executor», not Exact/SUCCESS.
   Recorded as a note, not as criticism — the owner's framing is the achievement.

3. **Frameless Sonnet contrast, no kernel (`out1.md`…`out4.md`, `log.json`,
   `run.py`).** Hop 1 decodes the intent correctly with the caveat «the exact
   axis layout cannot be recovered from the vector»; it refuses to invent the
   axes, corrects itself on hop 3, detects the self-referential «Да» loop on
   hop 4 and stops. Confounds: the system prompt «You are a reviewer» and the
   same family as the SV's author. Cost/session ($0.1663,
   `9d8665a5-3daa-472a-b458-daba7ade41a1`) are per the task record — `run.py`
   prints them to stdout; they are not stored in the files.

4. **Shared prior.** Both decoders measured oracle independence by correlation
   or agreement: kappa (Gemini) and spectral effective rank (Sonnet). Neither
   found «unique detection», so that criterion must be documented and resolvable
   (wiki/glossary), not left to a decoder's prior.

5. **The SV transmits intention and shape, not the axes' content.**
   «three-by-three oracles» was named without its documentation × code ×
   execution axes, so each decoder filled them from its own prior. Rule: name
   the axes in a dominant, and give every kernel term a glossary page
   (`docs/glossary.md`).

6. **What it means** (the owner's thesis, stated as the project paradigm, not
   as proof of AGI): the THINK half of the outer loop is portable to any
   capable model; the DO half is our robots + 3×3 oracles + memory (fossil,
   wiki, SV chains); closure comes from reality. Futures links:
   `plans/futures/2026-10-19_chat-interfaces-as-draft-producers.md`,
   `plans/futures/2026-10-19_tr-llm-rnd.md`.

## Owner (verbatim, 2026-10-19)

- «Совершенно верно отправь робота обновить доки. Сильный результат. Это надо записать.»
- «по сути он декодировал SV вектор и потом по кернелу сам поставил себе задачу и решил. По сути у нас реальный AGI цикл в действии»
- «Это само по себе серьезное достижение при 0 вводе с моей стороны.»
- «не забывай что это обычный чат без особых инструментов и возможности что либо ранать - чистая генерация.»

## Not measured / confounds

- n = 1 per arm; no randomization, no blinding, no repeat runs.
- The «Yes»/«yes» consent answers pace the chains; the chains are not autonomous.
- Sonnet ran frameless (`claude -p`, no tools) while Gemini ran in the owner's
  chat product — different harnesses, same no-tool condition.
- Sonnet shares a model family with the SV's author; Gemini does not.
- G7–G9 of the kernel run executed nothing: no sandbox, no file writes, no
  measured `content_hash` — the SUCCESS terminal is a simulated one.
