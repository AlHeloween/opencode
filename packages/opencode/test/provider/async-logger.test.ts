import { describe, expect, test } from "bun:test"
import { formatPerRequestEntry, makePerRequest, readableBody, readableResponseBody } from "@/provider/gateway/async-logger"
import fs from "fs"
import os from "os"
import path from "path"

describe("gateway per-request logger", () => {
  test("writes under the caller-supplied exchange fileName with the verbatim body", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gateway-request-"))
    const logger = makePerRequest({ dir })
    const fileName = "2026-09-24T09-00-00-000Z-req_live_123.json"
    logger.log({
      id: "req_live_123",
      timestamp: 123,
      fileName,
      body: '{"model":"deepseek-v4-pro","messages":[]}',
    })
    await logger.dispose()

    const file = path.join(dir, fileName)
    const entry = JSON.parse(fs.readFileSync(file, "utf8")) as { body: string }
    // Verbatim (T1): the stored string IS the record.
    expect(entry.body).toBe('{"model":"deepseek-v4-pro","messages":[]}')
    expect(JSON.parse(entry.body).model).toBe("deepseek-v4-pro")
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("an entry without fileName is refused without throwing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gateway-request-"))
    const logger = makePerRequest({ dir })
    logger.log({ id: "req_no_file", timestamp: 1, body: "{}" })
    await logger.dispose()
    expect(fs.readdirSync(dir)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("stores the body verbatim — the string IS the record (T1)", () => {
    const body = '{"model":"deepseek-v4-pro","text":"hello\\u041fworld"}'
    const output = formatPerRequestEntry({
      type: "request",
      method: "POST",
      body,
    })

    // The stored value round-trips byte-for-byte: parse → the same string.
    const parsed = JSON.parse(output) as { body: string }
    expect(parsed.body).toBe(body)
    // No body_raw duplicate; parse/pretty are DERIVED views (the .diff sidecar).
    expect(output).not.toContain("body_raw")
  })

  test("non-JSON body stored as-is without body_raw", () => {
    const output = formatPerRequestEntry({
      type: "request",
      body: "plain text not json",
    })
    expect(output).toContain('"body": "plain text not json"')
    expect(output).not.toContain("body_raw")
  })

  test("entry without body works fine", () => {
    const output = formatPerRequestEntry({
      type: "request",
      method: "POST",
      url: "https://api.deepseek.com/v1/chat/completions",
    })
    expect(output).toContain('"method": "POST"')
    expect(output).toContain('"url": "https://api.deepseek.com/v1/chat/completions"')
  })
})

describe("readableBody", () => {
  test("parses JSON string into object", () => {
    const result = readableBody('{"key":"value"}')
    expect(result).toEqual({ key: "value" })
  })

  test("parses complex JSON string into object", () => {
    const result = readableBody(
      '{"choices":[{"delta":{"content":"hi"}}],"usage":{"total_tokens":5}}',
    )
    expect(result).toHaveProperty("choices")
    expect(result).toHaveProperty("usage")
  })

  test("returns non-JSON string as-is", () => {
    const result = readableBody("plain text")
    expect(result).toBe("plain text")
  })

  test("returns non-string values as-is", () => {
    const num = readableBody(42)
    expect(num).toBe(42)

    const obj = readableBody({ already: "parsed" })
    expect(obj).toEqual({ already: "parsed" })
  })

  test("returns malformed JSON as-is", () => {
    const result = readableBody("{broken json")
    expect(result).toBe("{broken json")
  })

  test("returns non-JSON string that starts with brace", () => {
    const result = readableBody("{not valid json at all")
    expect(result).toBe("{not valid json at all")
  })
})

describe("readableResponseBody", () => {
  test("non-stream: delegates to readableBody for JSON", () => {
    const result = readableResponseBody('{"key":"value"}', false)
    expect(result).toEqual({ key: "value" })
  })

  test("non-stream: delegates to readableBody for non-JSON", () => {
    const result = readableResponseBody("plain text", false)
    expect(result).toBe("plain text")
  })

  test("stream: splits SSE data lines into string array", () => {
    const sse =
      'data: {"id":"1","choices":[{"delta":{"content":"hi"}}]}\n' +
      '\n' +
      'data: {"id":"2","choices":[{"delta":{"content":"there"}}]}\n' +
      '\n' +
      'data: [DONE]\n' +
      '\n'
    const result = readableResponseBody(sse, true)
    expect(Array.isArray(result)).toBe(true)
    expect((result as string[]).length).toBe(2)
    expect((result as string[])[0]).toContain('"id":"1"')
    expect((result as string[])[1]).toContain('"id":"2"')
  })

  test("stream: preserves \\uXXXX escapes", () => {
    const sse = 'data: {"text":"hello\\u041fworld"}\n\n'
    const result = readableResponseBody(sse, true)
    expect((result as string[])[0]).toContain("\\u041f")
  })

  test("stream: empty SSE returns original body", () => {
    const result = readableResponseBody("", true)
    expect(result).toBe("")
  })

  test("stream: returns non-string as-is", () => {
    const result = readableResponseBody(42, true)
    expect(result).toBe(42)
  })
})
