/**
 * Recorded wire-parameter support — "descend once, record the rung", applied to the
 * request BODY instead of the transport.
 *
 * Acceptance is not advertised: an OpenAI-compatible endpoint publishes no request schema
 * (`GET /models` is a model list) and the Zen Go docs declare no per-model parameters
 * (measured 2026-10-12, https://opencode.ai/docs/go). There is no `alt-svc` for body
 * fields — so, exactly as with the transport ladder, the rung is discovered by DESCENT:
 * the provider's own rejection names the field
 * (`400 [unknown_parameter] ... json: unknown field "repetition_penalty"`), and the field
 * is recorded. Requests never probe; a pair with no record is sent untouched.
 *
 * Two sources, one gate:
 *   - the compiled SEED below — a rung pinned to a measurement (provenance in the comment);
 *   - the LEARNED facts the runtime records from the provider's own rejection, durable in
 *     the `provider_fact` table (`learned-facts.ts`).
 *
 * One gate serves every route: `stripUnsupportedWireParams` runs inside
 * ProviderTransform.providerOptions, so the sampling default, per-agent options,
 * variants and plugin mutations are all covered before the body is built.
 *
 * Key: `${providerID}/${modelID}` with the variant suffix stripped ("model:variant" → "model").
 */
import { LearnedFacts } from "./learned-facts"

export const UNSUPPORTED_WIRE_PARAMS: Record<string, readonly string[]> = {
  // Measured 2026-10-12. The failed call is captured byte-true in
  // .opencode/data/gateway/raw-wire/2026-10-12T04-30-16-488Z-...-attempt1.json:
  // the body carried "repetition_penalty":1.1 → zen/go answered
  // 400 [unknown_parameter] invalid request body: json: unknown field.
  // Same provider and session, mimo-v2.6-flash finished 11 turns with the field
  // in its body — the rejection is PER MODEL, so the entry stays model-scoped.
  "opencode-go/glm-5.3-flash": ["repetition_penalty"],
}

/** Seed ∪ learned, deduplicated — what this model's upstream must never be sent. Never throws. */
export function unsupportedWireParams(providerID: string, modelID: string): string[] {
  const seed = UNSUPPORTED_WIRE_PARAMS[LearnedFacts.factsKey(providerID, modelID)] ?? []
  const merged = [...seed]
  for (const field of LearnedFacts.loadFacts(providerID, modelID).unsupportedParams) {
    if (!merged.includes(field)) merged.push(field)
  }
  return merged
}

export function stripUnsupportedWireParams(
  model: { providerID: string; api: { id: string } },
  options: Record<string, any>,
): Record<string, any> {
  const drop = unsupportedWireParams(model.providerID, model.api.id)
  if (drop.length === 0) return options
  return Object.fromEntries(Object.entries(options).filter(([key]) => !drop.includes(key)))
}

export * as WireParams from "./wire-params"
