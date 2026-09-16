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

test("an envelope with no enumerable fields never prints as a bare {}", () => {
  // This is what reached stderr when the TUI failed to bootstrap: the envelope
  // JSON-stringifies to "{}", which reads as output rather than as a failure
  // and deletes the only clue about what went wrong.
  const envelope = {}
  Object.defineProperty(envelope, "message", {
    value: "workspace unavailable",
    enumerable: false,
  })

  expect(JSON.stringify(envelope)).toBe("{}")
  expect(errorFormat(envelope)).toBe("workspace unavailable")
  expect(errorMessage(envelope)).toBe("workspace unavailable")
})

test("an envelope with nothing at all says so in words", () => {
  // Still never "{}": if there is genuinely no message, the reader needs to
  // know that IS the situation, not wonder whether output went missing.
  expect(errorFormat({})).toBe("Unexpected error with no message or fields")
  expect(errorFormat(Object.create(null))).toBe("Unexpected error with no message or fields")
})

test("errorFormat and errorMessage do not fall back into each other", () => {
  // Both used to end by calling the other; an object neither could answer was
  // a stack overflow rather than a message.
  expect(() => errorFormat({ a: undefined })).not.toThrow()
  expect(() => errorMessage({ a: undefined })).not.toThrow()
})
