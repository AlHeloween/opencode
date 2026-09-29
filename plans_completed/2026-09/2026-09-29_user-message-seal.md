<!-- intention: every user message is sent as text + time + md5(text·time) so the field acts as a loop-containment barrier (doctrine §8) -> correlation damping without sampler knobs -->
# User-message seal: time + md5

**Status:** ACTIVE — owner directive 2026-09-29T08:47Z: «вместе с сообщением пользователя будем отправлять хеш от сообщения с временем… получим устойчивый демпфер корреляций». This applies the hypothesis recorded in `docs/kernel-quality-doctrine.md` §8 at runtime; the kernel stays untouched.

**Outcome (2026-09-29):** COMPLETE → `plans_completed/2026-09/`. Shipped exactly as the owner decided («Оставляй как есть — такая реакция модели … стоит очень много»), with the two reverts recorded in T3/T4 (the reasoning seal and the read-reminder seal both fed the repetition they were meant to damp) and the raw-wire check green on candidate 10.0.1152. Last residual closed: the `hasToolParts` audit — the variable in `message-v2.ts` was declared and never read, so it is removed (typecheck exit 0).

## Design

- New pure module `src/session/user-seal.ts`: `sealUserText(text, createdAtMs)` → `text + "\ntime: <ISO-8601>\nmd5: <32-hex>"`, digest = md5 of `text + "\n" + ISO`.
- Applied in `message-v2.ts` user conversion to the LAST real text part of each user message (synthetic parts — subtask markers — are never sealed).
- **Determinism is load-bearing:** the stamp uses `message.time.created`, never wall-clock at send time, so a replayed prefix stays byte-identical for the provider KV cache.
- **FIRED 2026-09-29T09:49:58Z** — the loop the falsifier names happened, so T3's replay seal and the read.ts reminder seal+duplication are removed (the user-message seal STAYS). Measured on deepseek-flash: one reasoning block carrying 85 `time:` / 84 `md5:` pairs and 1826 slash-close tags, 64 763 reasoning tokens in a single step, tool calls jammed for 3m08s; the same session before the seal reached the context: 0-1 stamp tokens per block. Instrument: `experiments/2026-09-29_seal-loop-forensics/loop_census.py`.

## Smoke Tests

- Baseline: none exists for the seal (new module) — unit tests are the baseline oracle by construction.
- Post-change: `bun test test/session/user-seal.test.ts` (determinism, both inputs move the digest, format: 32-hex + `md5:` label, last-text-part-only write-oracle on the converter) → green; `bun typecheck` exit 0; live: raw-wire user message shows the two appended lines.

## Tasks

- [x] ✓ T1 module `user-seal.ts` + `test/session/user-seal.test.ts` (4 cases: determinism, format 32-hex + `md5:` label, both inputs move the digest, write-oracle on the converter).
- [x] ✓ T2 wired into `message-v2.ts` user conversion (LAST real text part); 12 converter expectations updated to the sealed form.
- [~] T3 REVERTED 2026-09-29 (the loop the falsifier names; see the fired-falsifier line above): reasoning is still returned and the 2026-08-30 tool-turn-only strip stays retired, but the per-block `time: …` + `md5: …` is REMOVED — the seal fed the repetition it was meant to damp.
- [~] T4 PARTLY REVERTED 2026-09-29: the `tool/read.ts` reminder is DE-DUPLICATED and UNSEALED (it was emitted twice, each copy stamped with `Date.now()` — a repeating message with a moving key); the one-shot `tool/plan.ts` identity-switch alert keeps its seal.
- [x] ✓ T5 oracles: `bun test test/session/user-seal.test.ts test/session/message-v2.test.ts test/tool/read.test.ts` → **84 pass / 0 fail** (run `20260929T085611Z_f3b16614`); `bun typecheck` exit 0 (`20260929T085653Z_e791298b`).
- [x] ✓ **Live raw-wire check** (candidate 10.0.1152, stand run `20260929T090332Z_612b53b3`): the seal is present on the wire and byte-stable across requests — `time: 2026-09-29T09:03:43.446Z` + `md5: f91cf28252a8129ec4cc5a9be1d8e1bd` in both the 09:03:44 and 09:05:18 requests. Zen returns reasoning as `encrypted_content` (platform property — plaintext reasoning seal is not visible there).
- [x] ✓ **Owner decision 2026-09-29T09:07Z, verbatim: «Оставляй как есть — такая реакция модели что она выдала опросник прямо сходу — стоит очень много.»** Keep the binding exactly as shipped: no relabeling, no assistant-side seal. Observed reaction: on first contact the model answered with a question-tool questionnaire (options 1–4) — the owner rates this behaviour highly; the sent md5 was echoed into the model's own SV field (copy-through, not a loop).
- [x] ✓ Residual closed: `hasToolParts` in `message-v2.ts` was declared and never read — REMOVED (dead weight); typecheck exit 0.

## Tooling note (cost two repair rounds)

The literal opening tag `<system-reminder>` does NOT survive a write through the edit tool verbatim — it arrived as a backtick, twice (read.ts:448). Use the `\x3c` escape when a template literal must carry it.
