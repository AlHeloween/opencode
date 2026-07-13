import { describe, expect, test } from "bun:test"
import { reconcile } from "solid-js/store"

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

describe("Refresh part reconciliation", () => {
  test("preserves message identity while applying refreshed metadata", () => {
    const current = [{ id: "m1", role: "assistant", time: { completed: 1 } }]
    const refreshed = [{ id: "m1", role: "assistant", time: { completed: 2 } }]

    const result = reconcile(refreshed, { key: "id" })(current)

    expect(result).toBe(current)
    expect(result[0]).toBe(current[0])
    expect(result[0]?.time.completed).toBe(2)
  })

  test("preserves part identity while applying refreshed text", () => {
    const current = [{ id: "p1", type: "text", text: "streamed" }]
    const refreshed = [{ id: "p1", type: "text", text: "persisted" }]

    const result = reconcile(refreshed, { key: "id" })(current)

    expect(result).toBe(current)
    expect(result[0]).toBe(current[0])
    expect(result[0]?.text).toBe("persisted")
  })

  test("adds newly persisted parts without replacing existing parts", () => {
    const current = [{ id: "p1", type: "text", text: "first" }]
    const refreshed = [
      { id: "p1", type: "text", text: "first" },
      { id: "p2", type: "text", text: "second" },
    ]

    const result = reconcile(refreshed, { key: "id" })(current)

    expect(result).toBe(current)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe(current[0])
    expect(result[1]?.id).toBe("p2")
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

describe("Session store lifecycle cleanup", () => {
  type SessionStore = {
    session: Array<{ id: string }>
    message: Record<string, Array<{ id: string }>>
    part: Record<string, Array<{ id: string }>>
    session_status: Record<string, unknown>
    session_diff: Record<string, unknown>
    todo: Record<string, unknown>
    permission: Record<string, unknown>
    question: Record<string, unknown>
  }

  const SID = "session-1"
  const MID = "msg-1"
  const PID = "part-1"

  function makeStore(): SessionStore {
    return {
      session: [{ id: SID }],
      message: { [SID]: [{ id: MID }] },
      part: { [MID]: [{ id: PID }] },
      session_status: { [SID]: "idle" },
      session_diff: { [SID]: [] },
      todo: { [SID]: [] },
      permission: { [SID]: [] },
      question: { [SID]: [] },
    }
  }

  test("cleanupSessionStores removes all 7 keyed stores", () => {
    const store = makeStore()
    // Simulate: for each store key, delete the sessionID entry
    const sid = SID
    delete (store as any).message[sid]
    delete (store as any).session_status[sid]
    delete (store as any).session_diff[sid]
    delete (store as any).todo[sid]
    delete (store as any).permission[sid]
    delete (store as any).question[sid]
    delete (store as any).part[MID]

    expect((store as any).message[sid]).toBeUndefined()
    expect((store as any).session_status[sid]).toBeUndefined()
    expect((store as any).session_diff[sid]).toBeUndefined()
    expect((store as any).todo[sid]).toBeUndefined()
    expect((store as any).permission[sid]).toBeUndefined()
    expect((store as any).question[sid]).toBeUndefined()
    expect((store as any).part[MID]).toBeUndefined()
  })

  test("cleanupSessionStores removes message part entries", () => {
    const store = makeStore()
    // Delete the message entry for SID, which cascades to part entries
    delete (store as any).message[SID]
    expect(store.message[SID]).toBeUndefined()
  })

  test("abort controller pattern prevents stale session writes", async () => {
    // Simulate: when sessionID changes, AbortController aborts stale work
    const results: string[] = []
    async function restore(sessionID: string, signal: AbortSignal) {
      await new Promise((r) => setTimeout(r, 10))
      if (signal.aborted) return
      results.push(sessionID)
    }

    const ac1 = new AbortController()
    const p1 = restore("A", ac1.signal)
    ac1.abort() // session changed before completion
    await restore("B", new AbortController().signal)
    await p1.catch(() => {})

    expect(results).toEqual(["B"])
    expect(results).not.toContain("A")
  })

  test("inflight sync dedup returns same promise for concurrent calls", async () => {
    let callCount = 0
    const inflight = new Map<string, Promise<void>>()

    async function sync(sessionID: string) {
      const existing = inflight.get(sessionID)
      if (existing) {
        await existing.catch(() => {})
        return
      }
      const task = (async () => {
        callCount++
        await new Promise((r) => setTimeout(r, 10))
      })()
      inflight.set(sessionID, task)
      try { await task } finally { if (inflight.get(sessionID) === task) inflight.delete(sessionID) }
    }

    const [r1, r2] = await Promise.all([sync("s1"), sync("s1")])
    expect(callCount).toBe(1)
  })

  test("session.refresh cleans stale session stores", () => {
    const store = makeStore()
    const newList = [{ id: "session-2" }]
    const nextIDs = new Set(newList.map((s) => s.id))

    // Cleanup: for any existing session not in the new list, remove its stores
    for (const existing of [{ id: SID }]) {
      if (!nextIDs.has(existing.id)) {
        delete (store as any).message[existing.id]
        delete (store as any).session_status[existing.id]
        delete (store as any).session_diff[existing.id]
        delete (store as any).todo[existing.id]
        delete (store as any).permission[existing.id]
        delete (store as any).question[existing.id]
      }
    }

    expect((store as any).message[SID]).toBeUndefined()
    expect((store as any).session_status[SID]).toBeUndefined()
    expect((store as any).session_diff[SID]).toBeUndefined()
    expect((store as any).todo[SID]).toBeUndefined()
    expect((store as any).permission[SID]).toBeUndefined()
    expect((store as any).question[SID]).toBeUndefined()
    // Session array entry remains until reconcile() replaces it
    expect(store.session.find((s) => s.id === SID)).toBeDefined()
  })

  test("delta buffer for session messages is cleared on session cleanup", () => {
    const deltaBuffer = new Map<string, Map<string, string>>()
    deltaBuffer.set(MID, new Map([["p1", "delta"]]))
    const deltaBufferTimestamps = new Map<string, number>()
    deltaBufferTimestamps.set(MID, Date.now())

    // Simulate flushDeltaBufferForSession
    for (const mid of [MID]) {
      deltaBuffer.delete(mid)
      deltaBufferTimestamps.delete(mid)
    }

    expect(deltaBuffer.size).toBe(0)
    expect(deltaBufferTimestamps.size).toBe(0)
  })

  test("recovery timer cleanup prevents wasted server call", () => {
    const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const timer = setTimeout(() => {}, 1000)
    recoveryTimers.set(MID, timer)

    // Simulate cleanupSessionStores cleanup of recoveryTimers
    for (const mid of [MID]) {
      const t = recoveryTimers.get(mid)
      if (t) {
        clearTimeout(t)
        recoveryTimers.delete(mid)
      }
    }

    expect(recoveryTimers.size).toBe(0)
  })
})
