import { createHash } from "node:crypto"

/**
 * User-message seal — the hypothesis from `docs/kernel-quality-doctrine.md` §8
 * (2026-09-29, owner directive): a `md5: <32hex>` field at the END of a user
 * message acts as a loop-containment barrier, damping self-reinforcing
 * correlations — and unlike a sampler penalty it costs nothing. Applied as:
 * message text, then the message time, then md5(text · time).
 *
 * Determinism is load-bearing for the provider KV cache: the stamp uses the
 * message's OWN `time.created` — never wall-clock at send time — so a replayed
 * prefix stays byte-identical across turns.
 */
export function sealUserText(text: string, createdAtMs: number): string {
  const time = new Date(createdAtMs).toISOString()
  const digest = createHash("md5").update(`${text}\n${time}`).digest("hex")
  return `${text}\n\ntime: ${time}\nmd5: ${digest}`
}
