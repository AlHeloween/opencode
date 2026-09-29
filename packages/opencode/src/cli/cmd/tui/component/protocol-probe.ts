/**
 * One-shot transport-rung probe, used at SELECTION time (owner directive, 2026-09-29:
 * «если выбрано авто то протокол должен 1 раз пробаться и фиксироваться, простым
 * запросом»). Pure module with an injected fetch so the contract is unit-testable
 * without a network — same shape as `protocol-options.ts`.
 *
 * Any HTTP answer proves the transport reached the origin — 200, 401, 405 are all the
 * response itself; only a transport-class throw (HTTP3HandshakeFailed, DNS/TLS failure,
 * timeout) rejects the rung. `h3` is tried first, matching the gateway's downgrade chain
 * (`adaptive-client.ts` `protocolChain`); a plain fetch then proves the non-QUIC path.
 */

export type ProbeFetch = (
  input: string,
  init?: { method?: string; protocol?: string; signal?: AbortSignal },
) => Promise<unknown>

export const PROBE_TIMEOUT_MS = 5000

/** True when the configured value needs resolving: unset (the `auto` default) or explicit `auto`. */
export function protocolNeedsProbe(configured: string | undefined | null): boolean {
  return configured === undefined || configured === null || configured === "auto"
}

async function reaches(
  fetchImpl: ProbeFetch,
  url: string,
  protocol: string | undefined,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined
    await fetchImpl(url, { method: "HEAD", protocol, signal })
    return true
  } catch {
    return false
  }
}

/** Resolve the rung with ONE probe per candidate: `h3` first, then the plain (h2/h1) path. */
export async function probeProtocol(input: {
  fetchImpl: ProbeFetch
  url: string
  timeoutMs?: number
}): Promise<"h3" | "h2" | undefined> {
  const timeoutMs = input.timeoutMs ?? PROBE_TIMEOUT_MS
  if (await reaches(input.fetchImpl, input.url, "http3", timeoutMs)) return "h3"
  if (await reaches(input.fetchImpl, input.url, undefined, timeoutMs)) return "h2"
  return undefined
}
