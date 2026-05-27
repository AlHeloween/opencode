import { describe, expect, test } from "bun:test"
import * as Log from "../../src/util/log"

describe("log", () => {
  test("writes valid JSON lines for inline payloads", () => {
    const writes: string[] = []
    const original = process.stderr.write
    process.stderr.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk))
      return true
    }) as typeof process.stderr.write

    try {
      Log.create({ service: "log-json-test-" + Date.now() }).error("inline payload", { value: "small" })
    } finally {
      process.stderr.write = original
    }

    const line = writes.join("").split(/\r?\n/).find((item) => item.includes("inline payload"))
    expect(line).toBeDefined()
    expect(JSON.parse(line!)).toMatchObject({
      level: "ERROR",
      message: "inline payload",
      payload: { value: "small" },
    })
  })
})
