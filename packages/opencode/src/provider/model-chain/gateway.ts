/**
 * One signal source for gateway stats and chain selection (t68, review R3).
 *
 * ONE AXIS, ONE PREDICATE: the chain does NOT count — no windows, no
 * counters, no thresholds of its own. All counting stays in
 * `provider/gateway/health-window.ts` (`HealthWindow`) and
 * `provider/gateway/circuit-breaker.ts` (`CircuitBreaker`). The chain is a
 * member SELECTOR driven by the same parsed provider refusal that is
 * already recorded in the gateway store.
 *
 * Integration duty (C5): the site that catches a provider error feeds ONE
 * object to both — `Store.recordError(routeKey, category)` for transport
 * stats, and `classifyChainError(gatewayErrorToChainInput(...))` for member
 * selection. A second breaker on the same signal would be the defect; this
 * adapter is the seam that prevents it.
 */
import { classifyChainError } from "./classify"
import type { ChainErrorClass, ChainErrorInput } from "./classify"

/**
 * Gateway `recordError` categories (`health-window.ts recordError`):
 * "429" | "5xx" | "conn_reset" | "read_timeout" (plus the "rate_or_rejection"
 * / "server_5xx" aliases it folds). Map them onto the chain input so both
 * consumers read the same refusal.
 */
export function gatewayErrorToChainInput(
  category: string,
  statusCode?: number,
  message?: string,
): ChainErrorInput {
  return { statusCode, message: message ?? category, code: category }
}

/** Classify straight from a gateway-recorded refusal. */
export function classifyGatewayError(
  category: string,
  statusCode?: number,
  message?: string,
): ChainErrorClass {
  return classifyChainError(gatewayErrorToChainInput(category, statusCode, message))
}
