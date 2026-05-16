import { describe, expect, test } from "bun:test"
import { mapOpenAICompatibleFinishReason } from "@/provider/sdk/copilot/chat/map-openai-compatible-finish-reason"

describe("mapOpenAICompatibleFinishReason", () => {
  test("maps stop", () => {
    expect(mapOpenAICompatibleFinishReason("stop")).toBe("stop")
  })

  test("maps length", () => {
    expect(mapOpenAICompatibleFinishReason("length")).toBe("length")
  })

  test("maps content_filter", () => {
    expect(mapOpenAICompatibleFinishReason("content_filter")).toBe("content-filter")
  })

  test("maps function_call", () => {
    expect(mapOpenAICompatibleFinishReason("function_call")).toBe("tool-calls")
  })

  test("maps tool_calls", () => {
    expect(mapOpenAICompatibleFinishReason("tool_calls")).toBe("tool-calls")
  })

  test("maps insufficient_system_resource to error", () => {
    expect(mapOpenAICompatibleFinishReason("insufficient_system_resource")).toBe("error")
  })

  test("maps unknown finish reasons to other", () => {
    expect(mapOpenAICompatibleFinishReason("some_unknown_reason")).toBe("other")
  })

  test("maps null to other", () => {
    expect(mapOpenAICompatibleFinishReason(null)).toBe("other")
  })

  test("maps undefined to other", () => {
    expect(mapOpenAICompatibleFinishReason(undefined)).toBe("other")
  })
})
