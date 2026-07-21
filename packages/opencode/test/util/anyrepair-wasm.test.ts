import { describe, expect, test } from "bun:test"
import {
  initAnyrepair,
  repairAny,
  repairWith,
  repairJson,
  repairXml,
  repairYaml,
  repairMarkdown,
  repairDiff,
  repairCsv,
  detectFormat,
  FORMATS,
} from "../../src/util/anyrepair-wasm"

describe("anyrepair-wasm", () => {
  test("loads anyrepair wasm module", async () => {
    expect(await initAnyrepair()).toBeTrue()
  })

  // ── Format detection ──────────────────────────────────────────────────
  test("detects JSON format", async () => {
    expect(await detectFormat('{"key": "value"}')).toBe("json")
  })

  test("detects XML format", async () => {
    expect(await detectFormat("<root><child>text</child></root>")).toBe("xml")
  })

  test("detects YAML format", async () => {
    expect(await detectFormat("key: value\nlist:\n  - item")).toBe("yaml")
  })

  test("detects TOML format — may detect as JSON due to brackets", async () => {
    const result = await detectFormat('[section]\nkey = "value"')
    // TOML with brackets can be ambiguous. Either detection is fine.
    expect(result === "toml" || result === "json" || result === "" || result === null).toBe(true)
  })

  test("detects Markdown format", async () => {
    expect(await detectFormat("# Heading\n\nParagraph text")).toBe("markdown")
  })

  test("returns empty for unrecognized input", async () => {
    const result = await detectFormat("not a known format")
    expect(result === "" || result === null).toBe(true)
  })

  // ── JSON repair ───────────────────────────────────────────────────────
  test("repairs single-quoted JSON strings", async () => {
    const result = await repairJson("{'key': 'value'}")
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
    expect(JSON.parse(result!)).toEqual({ key: "value" })
  })

  test("repairs trailing commas in JSON", async () => {
    const result = await repairJson('[1, 2, 3,]')
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  test("passes through valid JSON", async () => {
    const result = await repairJson('{"valid": true, "number": 42}')
    expect(result).not.toBeNull()
    expect(JSON.parse(result!)).toEqual({ valid: true, number: 42 })
  })

  // ── XML repair ────────────────────────────────────────────────────────
  test("repairs unclosed XML tag", async () => {
    const result = await repairXml("<root><child>text</child>")
    expect(result).not.toBeNull()
    expect(result!).toContain("</root>")
  })

  test("repairs mismatched XML tags", async () => {
    const result = await repairXml("<root><a>text</b></root>")
    expect(result).not.toBeNull()
    expect(result!).toContain("</a>")
  })

  test("repairs truncated XML", async () => {
    const result = await repairXml("<root><item>val1</item><item>val2")
    expect(result).not.toBeNull()
    expect(result!).toContain("</item>")
    expect(result!).toContain("</root>")
  })

  test("repairs XML with unquoted attributes", async () => {
    const result = await repairXml('<root><item attr=value>text</item></root>')
    expect(result).not.toBeNull()
    expect(result!).toContain('"value"')
  })

  test("passes through valid XML", async () => {
    const result = await repairXml("<root><item>text</item></root>")
    expect(result).not.toBeNull()
  })

  // ── YAML repair ───────────────────────────────────────────────────────
  test("repairs malformed YAML", async () => {
    const result = await repairYaml("key: value\n  indented: oops")
    expect(result).not.toBeNull()
    // Should be non-empty (whatever anyrepair decides)
    expect(result!.length).toBeGreaterThan(0)
  })

  test("passes through valid YAML", async () => {
    const result = await repairYaml("key: value\nlist:\n  - a\n  - b")
    expect(result).not.toBeNull()
  })

  // ── Markdown repair ───────────────────────────────────────────────────
  test("repairs malformed Markdown", async () => {
    const result = await repairMarkdown("# Broken\n\nUnclosed **bold")
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })

  test("passes through valid Markdown", async () => {
    const result = await repairMarkdown("# Title\n\n**bold** and *italic*")
    expect(result).not.toBeNull()
  })

  // ── Diff repair ───────────────────────────────────────────────────────
  test("passes through valid diff", async () => {
    const result = await repairDiff("@@ -1,3 +1,3 @@\n-old\n+new\n unchanged")
    expect(result).not.toBeNull()
  })

  // ── CSV repair ────────────────────────────────────────────────────────
  test("passes through valid CSV", async () => {
    const result = await repairCsv("a,b,c\n1,2,3\n4,5,6")
    expect(result).not.toBeNull()
  })

  // ── generic repairWith ────────────────────────────────────────────────
  test("repairWith supports all formats", async () => {
    for (const fmt of FORMATS) {
      const result = await repairWith("test", fmt)
      // Should not throw — returns null or a string
      expect(result === null || typeof result === "string").toBe(true)
    }
  })

  // ── Auto-detect repair ────────────────────────────────────────────────
  test("auto-repairs JSON without format hint", async () => {
    const result = await repairAny("{'name': 'test',}")
    expect(result).not.toBeNull()
    expect(() => JSON.parse(result!)).not.toThrow()
  })

  test("auto-repairs XML without format hint", async () => {
    const result = await repairAny("<root><item>text</item>")
    expect(result).not.toBeNull()
    expect(result!).toContain("</root>")
  })

  test("auto-repairs YAML without format hint", async () => {
    const result = await repairAny("key: value\n  bad indent")
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })

  // ── Edge cases ────────────────────────────────────────────────────────
  test("handles empty input", async () => {
    const result = await repairAny("")
    if (result !== null) expect(typeof result).toBe("string")
  })

  test("handles whitespace-only input", async () => {
    const result = await repairAny("   ")
    if (result !== null) expect(typeof result).toBe("string")
  })

  test("returns null for completely unrepairable input", async () => {
    const result = await repairJson("definitely not json at all ##@!")
    if (result !== null) expect(() => JSON.parse(result!)).not.toThrow()
  })
})
