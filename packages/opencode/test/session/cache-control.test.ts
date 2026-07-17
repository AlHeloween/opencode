import { beforeAll, describe, expect, test } from "bun:test"
import {
  normalizeToolSchemas,
  computePrefixShape,
  requestFingerprint,
  auditCache,
  toolSchemasFromRecord,
  xxh3Ready,
  type ToolSchema,
} from "../../src/session/cache-control"

beforeAll(async () => {
  await xxh3Ready()
})

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTextPart(id: string, text: string): any {
  return { type: "text", id, text, ignored: false }
}

function makeMsg(id: string, role: string, parts: any[]): any {
  return { info: { id, role }, parts }
}

function makeTool(name: string, description: string, params: Record<string, unknown> = {}): ToolSchema {
  return { name, description, parameters: JSON.stringify(params) }
}

// ── normalizeToolSchemas ────────────────────────────────────────────────────

describe("normalizeToolSchemas", () => {
  test("sorts by name ascending", () => {
    const input: ToolSchema[] = [
      makeTool("write", "Write a file"),
      makeTool("read", "Read a file"),
    ]
    const result = normalizeToolSchemas(input)
    expect(result.map((t) => t.name)).toEqual(["read", "write"])
  })

  test("tiebreaks by description when names equal", () => {
    const input: ToolSchema[] = [
      makeTool("tool", "zebra"),
      makeTool("tool", "alpha"),
    ]
    const result = normalizeToolSchemas(input)
    expect(result.map((t) => t.description)).toEqual(["alpha", "zebra"])
  })

  test("tiebreaks by parameters length when name+desc equal", () => {
    const short = makeTool("a", "desc", { x: 1 })
    const long = makeTool("a", "desc", { x: 1, y: 2 })
    const result = normalizeToolSchemas([long, short])
    expect(result[0]!.parameters.length).toBeLessThan(result[1]!.parameters.length)
  })

  test("does not mutate input array", () => {
    const input: ToolSchema[] = [
      makeTool("b", "second"),
      makeTool("a", "first"),
    ]
    const original = [...input]
    normalizeToolSchemas(input)
    expect(input).toEqual(original)
  })
})

// ── computePrefixShape ──────────────────────────────────────────────────────

describe("computePrefixShape", () => {
  const tools: ToolSchema[] = [
    makeTool("write", "Write a file", { path: "string", content: "string" }),
    makeTool("read", "Read a file", { path: "string" }),
  ]
  const toolsReversed: ToolSchema[] = [tools[1]!, tools[0]!]

  test("identical tools in different order → same toolsHash", () => {
    const a = computePrefixShape(["You are helpful"], tools)
    const b = computePrefixShape(["You are helpful"], toolsReversed)
    expect(a.toolsHash).toBe(b.toolsHash)
    expect(a.toolsOrderHash).toBe(b.toolsOrderHash)
    expect(a.prefixHash).toBe(b.prefixHash)
  })

  test("different system prompt → different systemOnlyHash", () => {
    const a = computePrefixShape(["System A"], tools)
    const b = computePrefixShape(["System B"], tools)
    expect(a.systemOnlyHash).not.toBe(b.systemOnlyHash)
    expect(a.prefixHash).not.toBe(b.prefixHash)
  })

  test("different tools → different toolsHash", () => {
    const a = computePrefixShape(["Sys"], tools)
    const b = computePrefixShape(["Sys"], [tools[0]!])
    expect(a.toolsHash).not.toBe(b.toolsHash)
  })

  test("includes toolsTokenEst", () => {
    const shape = computePrefixShape(["Sys"], tools)
    expect(shape.toolsTokenEst).toBeGreaterThan(0)
  })
})

// ── requestFingerprint ──────────────────────────────────────────────────────

describe("requestFingerprint", () => {
  const msg = makeMsg("m1", "user", [makeTextPart("p1", "Hello")])

  test("no toolSchemas → prefix is undefined (backward compat)", () => {
    const fp = requestFingerprint(["You are helpful"], [msg])
    expect(fp.prefix).toBeUndefined()
    expect(fp.systemHash.length).toBe(16)
    expect(fp.fullHash.length).toBe(16)
    expect(fp.messages.length).toBe(1)
  })

  test("with toolSchemas → prefix is populated", () => {
    const tools: ToolSchema[] = [makeTool("read", "Read a file")]
    const fp = requestFingerprint(["You are helpful"], [msg], undefined, tools)
    expect(fp.prefix).toBeDefined()
    expect(fp.prefix!.systemOnlyHash.length).toBe(16)
    expect(fp.prefix!.toolsHash.length).toBe(16)
    expect(fp.prefix!.toolsOrderHash.length).toBe(16)
    expect(fp.prefix!.prefixHash.length).toBe(16)
  })
})

// ── auditCache (component blame) ────────────────────────────────────────────

describe("auditCache — component blame", () => {
  const msg = makeMsg("m1", "user", [makeTextPart("p1", "Hello")])
  const msg2 = makeMsg("m2", "assistant", [makeTextPart("p2", "Hi")])
  const tools: ToolSchema[] = [makeTool("read", "Read a file")]
  const toolsAlt: ToolSchema[] = [makeTool("write", "Write a file", { path: "string" })]

  test("system changed, tools same → broken", () => {
    const prev = requestFingerprint(["System A"], [msg], undefined, tools)
    const next = requestFingerprint(["System B"], [msg], undefined, tools)
    const entry = auditCache(prev, next, "test")
    expect(entry.kind).toBe("broken")
    expect(entry.changeDescription).toContain("system prompt changed (non-tool)")
    expect(entry.cacheStable).toBe(false)
  })

  test("tool content changed → broken", () => {
    const prev = requestFingerprint(["Sys"], [msg], undefined, tools)
    const next = requestFingerprint(["Sys"], [msg], undefined, toolsAlt)
    const entry = auditCache(prev, next, "test")
    expect(entry.kind).toBe("broken")
    expect(entry.changeDescription).toContain("tool schemas changed")
    expect(entry.cacheStable).toBe(false)
  })

  test("tool order changed only → stable (order normalized away)", () => {
    const toolsOrdered: ToolSchema[] = [
      makeTool("a", "first"),
      makeTool("b", "second"),
    ]
    const toolsReversed: ToolSchema[] = [toolsOrdered[1]!, toolsOrdered[0]!]
    const prev = requestFingerprint(["Sys"], [msg], undefined, toolsOrdered)
    const next = requestFingerprint(["Sys"], [msg], undefined, toolsReversed)
    const entry = auditCache(prev, next, "test")
    // Same content, different order → normalizeToolSchemas makes hashes match.
    expect(entry.kind).toBe("stable")
    expect(entry.cacheStable).toBe(true)
    expect(entry.changeDescription).toBe("none")
  })

  test("identical messages → stable", () => {
    const prev = requestFingerprint(["Sys"], [msg])
    const next = requestFingerprint(["Sys"], [msg])
    const entry = auditCache(prev, next, "test")
    expect(entry.kind).toBe("stable")
    expect(entry.changeDescription).toBe("none")
    expect(entry.cacheStable).toBe(true)
  })

  test("first request → baseline (not broken)", () => {
    const fp = requestFingerprint(["Sys"], [msg])
    const entry = auditCache(null, fp, "test")
    expect(entry.kind).toBe("baseline")
    expect(entry.changeDescription).toContain("first request")
    expect(entry.cacheStable).toBe(true)
  })

  test("message appended → extend (prefix still stable)", () => {
    const prev = requestFingerprint(["Sys"], [msg], undefined, tools)
    const next = requestFingerprint(["Sys"], [msg, msg2], undefined, tools)
    const entry = auditCache(prev, next, "test")
    expect(entry.kind).toBe("extend")
    expect(entry.cacheStable).toBe(true)
    expect(entry.changeDescription).toContain("new message appended")
    expect(entry.estimatedHitRatio).toBeGreaterThan(0)
  })

  test("mid-history message edit → broken", () => {
    const prev = requestFingerprint(["Sys"], [msg, msg2], undefined, tools)
    const edited = makeMsg("m1", "user", [makeTextPart("p1", "Hello edited")])
    const next = requestFingerprint(["Sys"], [edited, msg2], undefined, tools)
    const entry = auditCache(prev, next, "test")
    expect(entry.kind).toBe("broken")
    expect(entry.cacheStable).toBe(false)
    expect(entry.changeDescription).toMatch(/modified|content changed/)
  })

  test("message removed → broken", () => {
    const prev = requestFingerprint(["Sys"], [msg, msg2], undefined, tools)
    const next = requestFingerprint(["Sys"], [msg], undefined, tools)
    const entry = auditCache(prev, next, "test")
    expect(entry.kind).toBe("broken")
    expect(entry.cacheStable).toBe(false)
    expect(entry.changeDescription).toContain("message removed")
  })
})

// ── toolSchemasFromRecord ───────────────────────────────────────────────────

describe("toolSchemasFromRecord", () => {
  test("converts AI SDK record to ToolSchema[]", () => {
    const record = {
      read: { description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
      write: { description: "Write a file", parameters: { type: "object", properties: {} } },
    }
    const schemas = toolSchemasFromRecord(record)
    expect(schemas.length).toBe(2)
    expect(schemas[0]!.name).toBe("read")
    expect(schemas[0]!.description).toBe("Read a file")
    expect(schemas[0]!.parameters).toContain('"type":"object"')
  })

  test("missing description defaults to empty string", () => {
    const record = {
      bare: { parameters: {} },
    }
    const schemas = toolSchemasFromRecord(record)
    expect(schemas[0]!.description).toBe("")
  })

  test("missing parameters defaults to {}", () => {
    const record: Record<string, any> = {
      minimal: {},
    }
    const schemas = toolSchemasFromRecord(record)
    expect(schemas[0]!.parameters).toBe("{}")
  })
})
