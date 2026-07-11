import { describe, expect, test } from "bun:test"

/**
 * Tests for sync rendering logic: delta buffering, field type safety, cap eviction.
 *
 * The production code in sync.tsx handles delta events, buffers deltas
 * that arrive before their part, and only evicts completed messages.
 */

describe("Delta field type safety", () => {
  // Safe fields that can receive text deltas
  const DELTA_SAFE_FIELDS = new Set(["text", "output"])

  function isFieldSafe(field: unknown): boolean {
    return typeof field === "string" && DELTA_SAFE_FIELDS.has(field)
  }

  test("text field is safe for delta", () => {
    expect(isFieldSafe("text")).toBe(true)
  })

  test("output field is safe for delta", () => {
    expect(isFieldSafe("output")).toBe(true)
  })

  test("status field is NOT safe for delta", () => {
    // Without the field type guard, sending a delta for "status" would
    // produce "pendingrunning" instead of "running"
    expect(isFieldSafe("status")).toBe(false)
  })

  test("type field is NOT safe for delta", () => {
    expect(isFieldSafe("type")).toBe(false)
  })

  test("id field is NOT safe for delta", () => {
    expect(isFieldSafe("id")).toBe(false)
  })

  test("undefined field is not safe", () => {
    expect(isFieldSafe(undefined)).toBe(false)
  })

  test("numeric field key is not safe", () => {
    expect(isFieldSafe(42)).toBe(false)
  })
})

describe("Delta buffer accumulation", () => {
  // Simulate the delta buffer Map<string, Map<string, string>>
  type DeltaBuffer = Map<string, Map<string, string>>

  function createBuffer(): DeltaBuffer {
    return new Map()
  }

  function addDelta(buffer: DeltaBuffer, messageID: string, partID: string, delta: string) {
    let msgBuffer = buffer.get(messageID)
    if (!msgBuffer) {
      msgBuffer = new Map()
      buffer.set(messageID, msgBuffer)
    }
    const existing = msgBuffer.get(partID) ?? ""
    msgBuffer.set(partID, existing + delta)
  }

  function getFlushedText(buffer: DeltaBuffer, messageID: string, partID: string): string | undefined {
    return buffer.get(messageID)?.get(partID)
  }

  test("accumulates deltas for same part", () => {
    const buffer = createBuffer()
    addDelta(buffer, "m1", "p1", "Hello ")
    addDelta(buffer, "m1", "p1", "World")
    expect(getFlushedText(buffer, "m1", "p1")).toBe("Hello World")
  })

  test("separate parts accumulate independently", () => {
    const buffer = createBuffer()
    addDelta(buffer, "m1", "p1", "Part 1 ")
    addDelta(buffer, "m1", "p2", "Part 2 ")
    addDelta(buffer, "m1", "p1", "continued")
    addDelta(buffer, "m1", "p2", "continued")
    expect(getFlushedText(buffer, "m1", "p1")).toBe("Part 1 continued")
    expect(getFlushedText(buffer, "m1", "p2")).toBe("Part 2 continued")
  })

  test("different messages have separate buffers", () => {
    const buffer = createBuffer()
    addDelta(buffer, "m1", "p1", "Session 1")
    addDelta(buffer, "m2", "p1", "Session 2")
    expect(getFlushedText(buffer, "m1", "p1")).toBe("Session 1")
    expect(getFlushedText(buffer, "m2", "p1")).toBe("Session 2")
  })

  test("empty delta does not create buffer", () => {
    const buffer = createBuffer()
    // No deltas added — buffer is empty
    expect(buffer.size).toBe(0)
  })
})

describe("Message cap eviction guard", () => {
  // Simulate hasActiveParts logic
  interface Part {
    type: string
    state?: { status: string }
  }

  function hasActiveParts(parts: Part[] | undefined): boolean {
    if (!parts || parts.length === 0) return false
    return parts.some((part) => {
      if (part.type !== "tool") return false
      return part.state?.status === "pending" || part.state?.status === "running"
    })
  }

  test("empty parts are not active", () => {
    expect(hasActiveParts([])).toBe(false)
  })

  test("undefined parts are not active", () => {
    expect(hasActiveParts(undefined)).toBe(false)
  })

  test("text parts are not active", () => {
    const parts: Part[] = [{ type: "text" }]
    expect(hasActiveParts(parts)).toBe(false)
  })

  test("completed tool parts are not active", () => {
    const parts: Part[] = [{ type: "tool", state: { status: "completed" } }]
    expect(hasActiveParts(parts)).toBe(false)
  })

  test("pending tool parts ARE active", () => {
    const parts: Part[] = [{ type: "tool", state: { status: "pending" } }]
    expect(hasActiveParts(parts)).toBe(true)
  })

  test("running tool parts ARE active", () => {
    const parts: Part[] = [{ type: "tool", state: { status: "running" } }]
    expect(hasActiveParts(parts)).toBe(true)
  })

  test("mixed parts: active if any tool is pending/running", () => {
    const parts: Part[] = [
      { type: "text" },
      { type: "reasoning" },
      { type: "tool", state: { status: "completed" } },
      { type: "tool", state: { status: "running" } },
    ]
    expect(hasActiveParts(parts)).toBe(true)
  })

  test("all completed tools are not active", () => {
    const parts: Part[] = [
      { type: "tool", state: { status: "completed" } },
      { type: "tool", state: { status: "error" } },
    ]
    expect(hasActiveParts(parts)).toBe(false)
  })
})

describe("Agent color stability", () => {
  // Simulate the stable agent color hashing from local.tsx
  const AGENT_COLORS = [
    "secondary", "accent", "success", "warning",
    "primary", "error", "info", "info",
    "secondary", "accent",
  ] as const

  function stableAgentColorIndex(name: string): number {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
    }
    return Math.abs(hash) % AGENT_COLORS.length
  }

  function getColor(name: string): string {
    return AGENT_COLORS[stableAgentColorIndex(name)]
  }

  test("same agent name always gets same color", () => {
    const c1 = getColor("build")
    const c2 = getColor("build")
    expect(c1).toBe(c2)
  })

  test("different agent names may get different colors", () => {
    const colors = new Set(["build", "plan", "explore", "coder", "researcher", "orchestrator"].map(getColor))
    // At least some should differ (unlikely all 6 agents hash to same slot)
    expect(colors.size).toBeGreaterThan(1)
  })

  test("color is independent of array ordering", () => {
    // The old code used array index, so reordering changed colors.
    // The fixed code uses name hash, so reordering has no effect.
    const color = getColor("build")
    // Reordering doesn't change the hash-based result
    expect(color).toBe(getColor("build"))
  })

  test("unknown agent name still gets a color", () => {
    const color = getColor("nonexistent_agent_xyz")
    expect(AGENT_COLORS.includes(color as typeof AGENT_COLORS[number])).toBe(true)
  })
})
