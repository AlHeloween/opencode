<!-- intention: every user message is sent as text + time + md5(text·time) so the field acts as a loop-containment barrier (doctrine §8) -> correlation damping without sampler knobs -->
# User-message seal: time + md5

**Status:** ACTIVE — owner directive 2026-09-29T08:47Z: «вместе с сообщением пользователя будем отправлять хеш от сообщения с временем… получим устойчивый демпфер корреляций». This applies the hypothesis recorded in `docs/kernel-quality-doctrine.md` §8 at runtime; the kernel stays untouched.

## Design

- New pure module `src/session/user-seal.ts`: `sealUserText(text, createdAtMs)` → `text + "\ntime: <ISO-8601>\nmd5: <32-hex>"`, digest = md5 of `text + "\n" + ISO`.
- Applied in `message-v2.ts` user conversion to the LAST real text part of each user message (synthetic parts — subtask markers — are never sealed).
- **Determinism is load-bearing:** the stamp uses `message.time.created`, never wall-clock at send time, so a replayed prefix stays byte-identical for the provider KV cache.
- Falsifier (recorded, not hidden): if loops persist or reply quality degrades, the seal is removed and §8 gets the negative result.

## Smoke Tests

- Baseline: none exists for the seal (new module) — unit tests are the baseline oracle by construction.
- Post-change: `bun test test/session/user-seal.test.ts` (determinism, both inputs move the digest, format: 32-hex + `md5:` label, last-text-part-only write-oracle on the converter) → green; `bun typecheck` exit 0; live: raw-wire user message shows the two appended lines.

## Tasks

- [x] ✓ T1 module `user-seal.ts` + `test/session/user-seal.test.ts` (4 cases: determinism, format 32-hex + `md5:` label, both inputs move the digest, write-oracle on the converter).
- [x] ✓ T2 wired into `message-v2.ts` user conversion (LAST real text part); 12 converter expectations updated to the sealed form.
- [x] ✓ T3 ALL reasoning is returned, each block sealed with `time: …` + `md5: …` (owner directive 2026-09-29, same evening: «весь reasoning — возвращать, но завершать временем и хешем»); the 2026-08-30 tool-turn-only strip is retired and its tests rewritten (strip → return).
- [x] ✓ T4 system alerts sealed: `tool/read.ts` gated-workflow reminder (stamp lands in the persisted tool output — stable across replays) and `tool/plan.ts` identity-switch alert.
- [x] ✓ T5 oracles: `bun test test/session/user-seal.test.ts test/session/message-v2.test.ts test/tool/read.test.ts` → **84 pass / 0 fail** (run `20260929T085611Z_f3b16614`); `bun typecheck` exit 0 (`20260929T085653Z_e791298b`).
- [x] ✓ **Live raw-wire check** (candidate 10.0.1152, stand run `20260929T090332Z_612b53b3`): the seal is present on the wire and byte-stable across requests — `time: 2026-09-29T09:03:43.446Z` + `md5: f91cf28252a8129ec4cc5a9be1d8e1bd` in both the 09:03:44 and 09:05:18 requests. Zen returns reasoning as `encrypted_content` (platform property — plaintext reasoning seal is not visible there).
- [x] ✓ **Owner decision 2026-09-29T09:07Z, verbatim: «Оставляй как есть — такая реакция модели что она выдала опросник прямо сходу — стоит очень много.»** Keep the binding exactly as shipped: no relabeling, no assistant-side seal. Observed reaction: on first contact the model answered with a question-tool questionnaire (options 1–4) — the owner rates this behaviour highly; the sent md5 was echoed into the model's own SV field (copy-through, not a loop).
- [ ] Residual: `hasToolParts` audit (unused now? typecheck green either way).

## Tooling note (cost two repair rounds)

The literal opening tag `<system-reminder>` does NOT survive a write through the edit tool verbatim — it arrived as a backtick, twice (read.ts:448). Use the `\x3c` escape when a template literal must carry it.
