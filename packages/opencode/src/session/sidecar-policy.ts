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

/**
 * ONE request — no forced repair (owner ruling 2026-09-18; was 2).
 *
 * The repair iteration was load-bearing against the owner's intent and against
 * the budget: with the anchored template in place a four-section body is
 * invalid, so every capture took a second LLM call — caught as "3 calls,
 * expected 2" at `prompt.test.ts:866` the moment the template widened. It could
 * also come back invalid regardless (measured 2026-09-14: an 8_192 budget burned
 * 68 s and ~$0.04 to return `bodyLen: 0`, rejected). The draft is now stored as
 * written and its gaps are NAMED (`diagnoseSummaryGaps`), so a deficient summary
 * becomes something the agent fills while the checkpoint is still open, instead
 * of another request it may not be able to answer.
 */
export const SIDECAR_MAX_ATTEMPTS = 1

/** Minimum delay after every capture cycle, including failed/invalid cycles. */
export const SIDECAR_COOLDOWN_MS = 30_000

/**
 * No `outputTokenMax`: the sidecar takes the SAME budget rule as a normal turn (owner ruling
 * 2026-09-19), whose floor is exactly the 32 768 that used to be pinned here. Passing an override
 * would pin it back to a constant and re-open the gap between what the gate reserves and what the
 * request asks for — the defect class this value was part of.
 */
export function streamOptions() {
  return {
    checkpoint: true,
  } as const
}

export function isCoolingDown(lastAttempt: number | undefined, now: number): boolean {
  return lastAttempt !== undefined && now - lastAttempt < SIDECAR_COOLDOWN_MS
}
