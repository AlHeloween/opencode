import { describe, expect, test } from "bun:test"
import { errorData, errorFormat, errorMessage } from "../../src/util/error"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")

    const data = errorData(err)
    expect(data.type).toBe("Error")
    expect(data.message).toBe("boom")
    expect(String(data.formatted)).toContain("boom")
  })

  test("extracts message from record-like values", () => {
    const err = { message: "bad input", code: "E_BAD" }
    expect(errorMessage(err)).toBe("bad input")

    const data = errorData(err)
    expect(data.message).toBe("bad input")
    expect(data.code).toBe("E_BAD")
  })

  test("handles opaque throwables with custom toString", () => {
    const err = {
      toString() {
        return "ResolveMessage: Cannot resolve module"
      },
    }

    expect(errorMessage(err)).toBe("ResolveMessage: Cannot resolve module")

    const data = errorData(err)
    expect(data.message).toBe("ResolveMessage: Cannot resolve module")
    expect(String(data.formatted)).toContain("ResolveMessage")
  })

  test("SDK/HTTP-shaped objects do not become [object Object]", () => {
    expect(errorMessage({ data: { message: "Fossil snapshot history was recreated" } })).toBe(
      "Fossil snapshot history was recreated",
    )
    expect(errorMessage({ error: { message: "hash not found" } })).toBe("hash not found")
    expect(errorMessage({ error: "plain string error" })).toBe("plain string error")
    // bare empty throw from throwOnError must not toast as [object Object]
    const bare = errorMessage({})
    expect(bare).not.toBe("[object Object]")
    expect(bare.length).toBeGreaterThan(0)
  })
})
