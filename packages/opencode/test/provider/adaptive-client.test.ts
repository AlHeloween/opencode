import { describe, expect, test } from "bun:test"
import { requestMetadata, resolveGatewayProtocol } from "@/provider/gateway/adaptive-client"

describe("gateway protocol defaults", () => {
  test("selects h2 for OpenAI by default", () => {
    expect(resolveGatewayProtocol("openai")).toBe("h2")
  })

  test("keeps StreamLake on http/1.1 by default", () => {
    expect(resolveGatewayProtocol("streamlake")).toBe("http/1.1")
  })

  test("keeps unknown providers on http/1.1 by default", () => {
    expect(resolveGatewayProtocol("anthropic")).toBe("http/1.1")
  })

  test("uses explicit protocol over provider default", () => {
    expect(resolveGatewayProtocol("openai", "http/1.1")).toBe("http/1.1")
    expect(resolveGatewayProtocol("streamlake", "h2")).toBe("h2")
  })
})

describe("gateway request metadata", () => {
  test("uses the model sent in the body over a stale gateway header", () => {
    expect(requestMetadata('{"model":"deepseek-v4-pro","stream":true}')).toEqual({
      model: "deepseek-v4-pro",
      streaming: true,
    })
  })
})
