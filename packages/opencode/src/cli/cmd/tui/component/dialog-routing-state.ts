export type RoutingSort = "price" | "throughput" | "latency"
export type ProviderSelectionMode = "order" | "only"

/** Keep keyboard focus on controls, never on decorative section headings. */
export function routingMoveCursor(rows: readonly { kind: string }[], current: number, delta: number) {
  const actionable = rows.map((row) => row.kind !== "header")
  if (!actionable.some(Boolean) || delta === 0) return current

  let next = current
  for (let moved = 0; moved < Math.abs(delta); moved++) {
    do {
      next = (next + Math.sign(delta) + rows.length) % rows.length
    } while (!actionable[next])
  }
  return next
}

/** One-line description of the active routing mode — the dialog reports its
 * live mode instead of leaving it implicit. Sort dominates: selecting one
 * forces manual providers off, so it is checked first. */
export function routingModeLabel(input: {
  sort: RoutingSort | undefined
  providers: readonly string[]
  selectionMode: ProviderSelectionMode
}) {
  if (input.sort) {
    const label =
      input.sort === "price" ? "lowest price" : input.sort === "throughput" ? "highest throughput" : "lowest latency"
    return `Mode: dynamic OpenRouter routing by ${label}`
  }
  if (input.providers.length === 0) return "Mode: OpenRouter default dynamic routing"
  return `Mode: ${input.selectionMode === "only" ? "strict allow-list" : "provider priority order"} · ${input.providers.length} provider${input.providers.length === 1 ? "" : "s"}`
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export function routingProviderSelection(routing: Record<string, unknown>) {
  const only = stringList(routing.only)
  if (Array.isArray(routing.only)) return { mode: "only" as const, providers: only }
  return { mode: "order" as const, providers: stringList(routing.order) }
}

export function routingSort(routing: Record<string, unknown>): RoutingSort | undefined {
  if (routing.sort === "price" || routing.sort === "throughput" || routing.sort === "latency") {
    return routing.sort
  }
  return undefined
}

export function routingQuantizations(routing: Record<string, unknown>, available: string[]) {
  if (Object.prototype.hasOwnProperty.call(routing, "quantizations")) {
    return stringList(routing.quantizations)
  }
  const fp8 = available.find((value) => value.toLowerCase() === "fp8")
  return fp8 ? [fp8] : []
}

export function buildRouting(input: {
  current: Record<string, unknown>
  providers: string[]
  selectionMode: ProviderSelectionMode
  quantizations: string[]
  sort: RoutingSort | undefined
  allowFallbacks: boolean
}) {
  const routing = { ...input.current }
  delete routing.only
  delete routing.order
  delete routing.sort
  delete routing.quantizations
  delete routing.allow_fallbacks

  routing.allow_fallbacks = input.allowFallbacks
  if (input.sort) routing.sort = input.sort
  if (!input.sort && input.providers.length > 0) routing[input.selectionMode] = input.providers
  if (input.quantizations.length > 0) routing.quantizations = input.quantizations
  return routing
}
