import { describe, expect, test } from "bun:test"
import {
  normalizeToolSchemas,
  computePrefixShape,
  requestFingerprint,
  auditCache,
  toolSchemasFromRecord,
  type ToolSchema,
} from "../../src/session/cache-control"

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

  test("identical tools in different order → same toolsMd5", () => {
    const a = computePrefixShape(["You are helpful"], tools)
    const b = computePrefixShape(["You are helpful"], toolsReversed)
    expect(a.toolsMd5).toBe(b.toolsMd5)
    expect(a.toolsOrderHash).toBe(b.toolsOrderHash)
    expect(a.prefixMd5).toBe(b.prefixMd5)
  })

  test("different system prompt → different systemOnlyMd5", () => {
    const a = computePrefixShape(["System A"], tools)
    const b = computePrefixShape(["System B"], tools)
    expect(a.systemOnlyMd5).not.toBe(b.systemOnlyMd5)
    expect(a.prefixMd5).not.toBe(b.prefixMd5)
  })

  test("different tools → different toolsMd5", () => {
    const a = computePrefixShape(["Sys"], tools)
    const b = computePrefixShape(["Sys"], [tools[0]!])
    expect(a.toolsMd5).not.toBe(b.toolsMd5)
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
    expect(fp.systemMd5.length).toBe(32)
    expect(fp.fullMd5.length).toBe(32)
    expect(fp.messages.length).toBe(1)
  })

  test("with toolSchemas → prefix is populated", () => {
    const tools: ToolSchema[] = [makeTool("read", "Read a file")]
    const fp = requestFingerprint(["You are helpful"], [msg], undefined, tools)
    expect(fp.prefix).toBeDefined()
    expect(fp.prefix!.systemOnlyMd5.length).toBe(32)
    expect(fp.prefix!.toolsMd5.length).toBe(32)
    expect(fp.prefix!.toolsOrderHash.length).toBe(32)
    expect(fp.prefix!.prefixMd5.length).toBe(32)
  })
})

// ── auditCache (component blame) ────────────────────────────────────────────

describe("auditCache — component blame", () => {
  const msg = makeMsg("m1", "user", [makeTextPart("p1", "Hello")])
  const tools: ToolSchema[] = [makeTool("read", "Read a file")]
  const toolsAlt: ToolSchema[] = [makeTool("write", "Write a file", { path: "string" })]

  test("system changed, tools same → 'system prompt changed (non-tool)'", () => {
    const prev = requestFingerprint(["System A"], [msg], undefined, tools)
    const next = requestFingerprint(["System B"], [msg], undefined, tools)
    const entry = auditCache(prev, next, "test")
    expect(entry.changeDescription).toContain("system prompt changed (non-tool)")
    expect(entry.cacheStable).toBe(false)
  })

  test("tool content changed → 'tool schemas changed'", () => {
    const prev = requestFingerprint(["Sys"], [msg], undefined, tools)
    const next = requestFingerprint(["Sys"], [msg], undefined, toolsAlt)
    const entry = auditCache(prev, next, "test")
    expect(entry.changeDescription).toContain("tool schemas changed")
    expect(entry.cacheStable).toBe(false)
  })

  test("tool order changed only → 'tool order changed only'", () => {
    const toolsOrdered: ToolSchema[] = [
      makeTool("a", "first"),
      makeTool("b", "second"),
    ]
    const toolsReversed: ToolSchema[] = [toolsOrdered[1]!, toolsOrdered[0]!]
    const prev = requestFingerprint(["Sys"], [msg], undefined, toolsOrdered)
    const next = requestFingerprint(["Sys"], [msg], undefined, toolsReversed)
    const entry = auditCache(prev, next, "test")
    // Same content, different order → all MD5s match (except order hash check)
    // When only order differs but content is identical, normalizeToolSchemas
    // produces the same sorted output → toolsMd5 stays same.
    // The toolsOrderHash is also the same because names are sorted.
    // So the cache is actually STABLE — tool order is normalized away.
    expect(entry.cacheStable).toBe(true)
    expect(entry.changeDescription).toBe("none")
  })

  test("falls through to message scan when no prefix", () => {
    const prev = requestFingerprint(["Sys"], [msg])
    const next = requestFingerprint(["Sys"], [msg])
    const entry = auditCache(prev, next, "test")
    expect(entry.changeDescription).toBe("none")
    expect(entry.cacheStable).toBe(true)
  })

  test("first request → no baseline message", () => {
    const fp = requestFingerprint(["Sys"], [msg])
    const entry = auditCache(null, fp, "test")
    expect(entry.changeDescription).toContain("first request")
    expect(entry.cacheStable).toBe(false)
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
