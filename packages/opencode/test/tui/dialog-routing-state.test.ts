import { describe, expect, test } from "bun:test"
import {
  buildRouting,
  routingProviderSelection,
  routingQuantizations,
  routingSort,
} from "../../src/cli/cmd/tui/component/dialog-routing-state"

describe("routing dialog state", () => {
  test("surfaces a strict provider-only pin instead of hiding it", () => {
    expect(routingProviderSelection({ only: ["Modal"] })).toEqual({ mode: "only", providers: ["Modal"] })
    expect(routingProviderSelection({ order: ["baseten", "z-ai"] })).toEqual({
      mode: "order",
      providers: ["baseten", "z-ai"],
    })
  })

  test("recognizes OpenRouter price and speed sort modes", () => {
    expect(routingSort({ sort: "price" })).toBe("price")
    expect(routingSort({ sort: "throughput" })).toBe("throughput")
    expect(routingSort({ sort: "latency" })).toBe("latency")
    expect(routingSort({ sort: "unknown" })).toBeUndefined()
  })

  test("defaults to fp8 only when the live model offers it", () => {
    expect(routingQuantizations({}, ["bf16", "fp8", "int8"])).toEqual(["fp8"])
    expect(routingQuantizations({}, ["bf16", "int8"])).toEqual([])
    expect(routingQuantizations({ quantizations: [] }, ["fp8"])).toEqual([])
    expect(routingQuantizations({ quantizations: ["bf16"] }, ["fp8"])).toEqual(["bf16"])
  })

  test("dynamic sorting removes a stale provider pin and preserves native keys", () => {
    expect(
      buildRouting({
        current: { only: ["Modal"], max_price: { prompt: 1 } },
        providers: ["Modal"],
        selectionMode: "only",
        quantizations: ["fp8"],
        sort: "price",
        allowFallbacks: true,
      }),
    ).toEqual({
      max_price: { prompt: 1 },
      allow_fallbacks: true,
      sort: "price",
      quantizations: ["fp8"],
    })
  })

  test("manual provider selection retains strict-only semantics", () => {
    expect(
      buildRouting({
        current: { sort: "throughput" },
        providers: ["baseten", "z-ai"],
        selectionMode: "only",
        quantizations: [],
        sort: undefined,
        allowFallbacks: false,
      }),
    ).toEqual({ allow_fallbacks: false, only: ["baseten", "z-ai"] })
  })
})
