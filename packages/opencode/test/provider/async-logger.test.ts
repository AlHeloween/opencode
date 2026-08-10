import { describe, expect, test } from "bun:test"
import { formatPerRequestEntry } from "@/provider/gateway/async-logger"

describe("gateway per-request logger", () => {
  test("formats JSON request bodies as searchable nested JSON", () => {
    const output = formatPerRequestEntry({
      model: "deepseek-v4-pro",
      body: '{"model":"deepseek-v4-pro","tools":[{"type":"function"}]}',
    })

    expect(output).toContain('\n  "body": {')
    expect(output).toContain('\n    "model": "deepseek-v4-pro"')
    expect(output).not.toContain('\\"model\\"')
  })
})
