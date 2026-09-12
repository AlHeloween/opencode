export type RoutingSort = "price" | "throughput" | "latency"
export type ProviderSelectionMode = "order" | "only"

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
