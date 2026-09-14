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
export const SIDECAR_OUTPUT_TOKEN_MAX = 32_768

/**
 * Contingency lever, dormant by default. If a live capture still shows
 * `reasoningTokens >= SIDECAR_OUTPUT_TOKEN_MAX` with `outputTokens: 0` and
 * `finish_reason: "length"`, set this to "off" to disable thinking for the
 * sidecar chain only — variant is part of DeepSeek's prompt-cache key, so that
 * trades one cold prefill per capture for a guaranteed body.
 *
 * Owner ruling 2026-09-14: last resort only — the lever breaks the cached
 * content window the moment it is set and lowers the summary's quality; it is
 * never a cost lever. It also has no caller yet (nothing passes
 * `variantOverride` to the stream), so setting it alone changes nothing.
 */
export const SIDECAR_VARIANT_OVERRIDE: string | undefined = undefined

/** One full draft plus one targeted repair; later turns must not multiply cost. */
export const SIDECAR_MAX_ATTEMPTS = 2

/** Minimum delay after every capture cycle, including failed/invalid cycles. */
export const SIDECAR_COOLDOWN_MS = 30_000

export function streamOptions() {
  return {
    checkpoint: true,
    outputTokenMax: SIDECAR_OUTPUT_TOKEN_MAX,
  } as const
}

export function isCoolingDown(lastAttempt: number | undefined, now: number): boolean {
  return lastAttempt !== undefined && now - lastAttempt < SIDECAR_COOLDOWN_MS
}
