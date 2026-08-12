import { describe, expect, test } from "bun:test"
import { formatPerRequestEntry, makePerRequest, readableBody, readableResponseBody } from "@/provider/gateway/async-logger"
import fs from "fs"
import os from "os"
import path from "path"

describe("gateway per-request logger", () => {
  test("uses the wire request id in the filename and formats the stored body", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-gateway-request-"))
    const logger = makePerRequest({ dir })
    logger.log({
      id: "req_live_123",
      timestamp: 123,
      body: '{"model":"deepseek-v4-pro","messages":[]}',
    })
    await logger.dispose()

    const file = path.join(dir, "123_req_req_live_123.json")
    const entry = JSON.parse(fs.readFileSync(file, "utf8")) as { body: { model: string }; body_raw: string }
    expect(entry.body.model).toBe("deepseek-v4-pro")
    expect(entry.body_raw).toContain('"messages":[]')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test("formats JSON body as readable object + raw field preserves \\uXXXX", () => {
    const output = formatPerRequestEntry({
      type: "request",
      method: "POST",
      body: '{"model":"deepseek-v4-pro","text":"hello\\u041fworld"}',
    })

    // body is parsed → readable multiline JSON
    expect(output).toContain('\n  "body": {')
    expect(output).toContain('\n    "model": "deepseek-v4-pro"')

    // body_raw preserves original \uXXXX escapes
    expect(output).toContain('"body_raw": "')
    expect(output).toContain("\\u041f")
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
