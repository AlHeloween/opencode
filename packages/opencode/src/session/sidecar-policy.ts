/** Layer-1 summary calls must never inherit the normal reasoning-model budget. */
export const SIDECAR_OUTPUT_TOKEN_MAX = 8_192

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
