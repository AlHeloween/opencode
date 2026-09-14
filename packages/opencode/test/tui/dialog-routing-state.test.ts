import { describe, expect, test } from "bun:test"
import {
  buildRouting,
  routingMoveCursor,
  routingModeLabel,
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

  test("skips section headings for initial and page navigation", () => {
    const rows = [
      { kind: "header" },
      { kind: "sort" },
      { kind: "sort" },
      { kind: "header" },
      { kind: "provider" },
      { kind: "header" },
      { kind: "save" },
    ]
    expect(routingMoveCursor(rows, 1, 1)).toBe(2)
    expect(routingMoveCursor(rows, 2, 1)).toBe(4)
    expect(routingMoveCursor(rows, 4, 1)).toBe(6)
    expect(routingMoveCursor(rows, 1, -1)).toBe(6)
    expect(routingMoveCursor(rows, 1, 10)).toBe(4)
  })

  test("keeps the cursor when nothing is actionable or the move is zero", () => {
    const allHeaders = [{ kind: "header" }, { kind: "header" }]
    expect(routingMoveCursor(allHeaders, 0, 1)).toBe(0)
    expect(routingMoveCursor(allHeaders, 1, -1)).toBe(1)
    const mixed = [{ kind: "header" }, { kind: "sort" }]
    expect(routingMoveCursor(mixed, 1, 0)).toBe(1)
    expect(routingMoveCursor(mixed, 0, 0)).toBe(0)
  })

  test("lands on a control from a header position and crosses header runs", () => {
    const rows = [
      { kind: "header" },
      { kind: "sort" },
      { kind: "header" },
      { kind: "header" },
      { kind: "header" },
      { kind: "provider" },
      { kind: "header" },
    ]
    expect(routingMoveCursor(rows, 0, 1)).toBe(1)
    expect(routingMoveCursor(rows, 0, -1)).toBe(5)
    expect(routingMoveCursor(rows, 1, 1)).toBe(5)
    expect(routingMoveCursor(rows, 5, 1)).toBe(1)
    expect(routingMoveCursor(rows, 5, -1)).toBe(1)
  })

  test("a single actionable row captures every move", () => {
    const rows = [{ kind: "header" }, { kind: "save" }]
    expect(routingMoveCursor(rows, 1, 1)).toBe(1)
    expect(routingMoveCursor(rows, 1, -10)).toBe(1)
    expect(routingMoveCursor(rows, 1, 10)).toBe(1)
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

  test("OpenRouter default removes a stale manual provider selection", () => {
    expect(
      buildRouting({
        current: { only: ["Modal"], max_price: { prompt: 1 } },
        providers: [],
        selectionMode: "only",
        quantizations: ["fp8"],
        sort: undefined,
        allowFallbacks: true,
      }),
    ).toEqual({
      max_price: { prompt: 1 },
      allow_fallbacks: true,
      quantizations: ["fp8"],
    })
  })

  test("reports the active routing mode in the header line", () => {
    expect(routingModeLabel({ sort: "price", providers: [], selectionMode: "order" })).toBe(
      "Mode: dynamic OpenRouter routing by lowest price",
    )
    expect(routingModeLabel({ sort: "throughput", providers: [], selectionMode: "order" })).toBe(
      "Mode: dynamic OpenRouter routing by highest throughput",
    )
    expect(routingModeLabel({ sort: "latency", providers: [], selectionMode: "order" })).toBe(
      "Mode: dynamic OpenRouter routing by lowest latency",
    )
    expect(routingModeLabel({ sort: undefined, providers: [], selectionMode: "only" })).toBe(
      "Mode: OpenRouter default dynamic routing",
    )
    // Sort dominates: selecting a dynamic mode clears the manual list, so the
    // label must never claim a manual selection next to an active sort.
    expect(routingModeLabel({ sort: "price", providers: ["Modal"], selectionMode: "only" })).toBe(
      "Mode: dynamic OpenRouter routing by lowest price",
    )
  })

  test("counts manual providers with matching plurality", () => {
    expect(routingModeLabel({ sort: undefined, providers: ["Modal"], selectionMode: "only" })).toBe(
      "Mode: strict allow-list · 1 provider",
    )
    expect(routingModeLabel({ sort: undefined, providers: ["Modal", "baseten"], selectionMode: "only" })).toBe(
      "Mode: strict allow-list · 2 providers",
    )
    expect(routingModeLabel({ sort: undefined, providers: ["Modal", "baseten"], selectionMode: "order" })).toBe(
      "Mode: provider priority order · 2 providers",
    )
  })
})
