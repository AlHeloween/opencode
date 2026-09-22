/**
 * Layer-1 summary calls must never inherit the normal reasoning-model budget,
 * but the cap still has to clear the body it is asked to produce. Measured
 * 2026-09-14 at the previous value of 8_192: two consecutive attempts returned
 * `out=0 reasoning=8192`, `finish_reason: "length"` — a thinking model spends
 * `max_tokens` on reasoning FIRST, so a budget at or below
 * `MAX_SUMMARY_BODY_TOKENS` (16_384) cannot emit a single content byte, and the
 * cycle burned 68s and ~$0.04 to be rejected with `bodyLen: 0`.
 *
 * Raising the budget is the only lever here: `reasoning_effort` is part of
 * DeepSeek's prompt-cache key (measured — switching effort is a full prefix
 * miss), so lowering effort for the sidecar would make every summary a cold
 * prefill of the whole conversation.
 *
 * Floor, not a dial (owner ruling 2026-09-14): only the ANSWER is stored in
 * the checkpoint — the reasoning half is discarded — so 32_768 funds both: a
 * 16K reasoning window + the 16K body cap (`MAX_SUMMARY_BODY_TOKENS`).
 * Shrinking it re-creates the unsatisfiable budget; a lower value needs a new
 * measurement, not reclaimed margin.
 */
// 32_768 is no longer a SEPARATE constant here: it is the FLOOR of the shared output rule
// (`ProviderTransform.maxOutputTokens`, owner ruling 2026-09-19 «для сайдкара тоже самое»), so the
// sidecar inherits it and scales with the window above it instead of being pinned to it.

// SIDECAR_VARIANT_OVERRIDE and SIDECAR_MAX_ATTEMPTS were removed with the generation itself
// (owner, 2026-09-22: «summary как sidecar не надо генерить вовсе. Совсем.»): an attempt counter and
// a reasoning-variant lever have nothing to count or steer once no request is made. They are in git
// and fossil if anyone needs to read them again — the working code does not carry a museum.

/** Minimum delay after every capture cycle, including failed/invalid cycles. */
export const SIDECAR_COOLDOWN_MS = 30_000

export function isCoolingDown(lastAttempt: number | undefined, now: number): boolean {
  return lastAttempt !== undefined && now - lastAttempt < SIDECAR_COOLDOWN_MS
}
