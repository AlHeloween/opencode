import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { createGeminiProvider } from "../../src/provider/google-code-assist"

describe("google-code-assist", () => {
  test("creates provider with languageModel method", () => {
    const provider = createGeminiProvider({ accessToken: "test-token" })
    expect(provider.languageModel).toBeDefined()
    expect(typeof provider.languageModel).toBe("function")
  })

  test("creates language model with correct properties", () => {
    const provider = createGeminiProvider({ accessToken: "test-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    expect(model.specificationVersion).toBe("v2")
    expect(model.provider).toBe("google")
    expect(model.modelId).toBe("gemini-2.5-flash")
  })

  test("doGenerate sends correct request headers", async () => {
    const originalFetch = globalThis.fetch
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Hello!" }] }, finishReason: "STOP" }],
      }),
      text: async () => "",
    }))
    globalThis.fetch = mockFetch as any

    const provider = createGeminiProvider({ accessToken: "my-secret-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    })

    expect(mockFetch).toHaveBeenCalled()
    const call = (mockFetch as any).mock.calls[0]
    if (!call) throw new Error("fetch not called")
    const [url, options] = call
    expect(url).toContain("generativelanguage.googleapis.com")
    expect((options.headers as Record<string, string>).Authorization).toBe("Bearer my-secret-token")
    expect((options.headers as Record<string, string>)["Content-Type"]).toBe("application/json")

    globalThis.fetch = originalFetch
  })

  test("doGenerate parses response correctly", async () => {
    const originalFetch = globalThis.fetch
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Hello World!" }] }, finishReason: "STOP" }],
      }),
      text: async () => "",
    }))
    globalThis.fetch = mockFetch as any

    const provider = createGeminiProvider({ accessToken: "test-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    const result = await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({ type: "text", text: "Hello World!" })
    expect(result.finishReason).toBe("stop")

    globalThis.fetch = originalFetch
  })

  test("doGenerate maps MAX_TOKENS finish reason to length", async () => {
    const originalFetch = globalThis.fetch
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Truncated" }] }, finishReason: "MAX_TOKENS" }],
      }),
      text: async () => "",
    }))
    globalThis.fetch = mockFetch as any

    const provider = createGeminiProvider({ accessToken: "test-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    const result = await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    })

    expect(result.finishReason).toBe("length")

    globalThis.fetch = originalFetch
  })

  test("doGenerate maps SAFETY finish reason to content-filter", async () => {
    const originalFetch = globalThis.fetch
    const mockFetch = mock(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Blocked" }] }, finishReason: "SAFETY" }],
      }),
      text: async () => "",
    }))
    globalThis.fetch = mockFetch as any

    const provider = createGeminiProvider({ accessToken: "test-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    const result = await model.doGenerate({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    })

    expect(result.finishReason).toBe("content-filter")

    globalThis.fetch = originalFetch
  })

  test("doGenerate includes system instruction when provided", async () => {
    const originalFetch = globalThis.fetch
    let capturedBody: any
    const mockFetch = mock(async (_url: string, options: any) => {
      capturedBody = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Hi" }] }, finishReason: "STOP" }],
        }),
        text: async () => "",
      }
    })
    globalThis.fetch = mockFetch as any

    const provider = createGeminiProvider({ accessToken: "test-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    await model.doGenerate({
      prompt: [
        {
          role: "system",
          content: "You are a helpful assistant",
        },
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    })

    expect(capturedBody.systemInstruction).toBeDefined()
    expect(capturedBody.systemInstruction).toEqual({
      role: "user",
      parts: [{ text: "You are a helpful assistant" }],
    })

    globalThis.fetch = originalFetch
  })

  test("doStream sends correct request", async () => {
    const originalFetch = globalThis.fetch
    const mockResponse = {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]},"finishReason":"STOP"}]}\n\n',
            ),
          )
          controller.close()
        },
      }),
      text: async () => "",
    }
    globalThis.fetch = mock(async () => mockResponse) as any

    const provider = createGeminiProvider({ accessToken: "test-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    const result = await model.doStream({
      prompt: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      ],
    })

    expect(result.stream).toBeDefined()

    globalThis.fetch = originalFetch
  })

  test("doGenerate handles API error response", async () => {
    const originalFetch = globalThis.fetch
    const mockFetch = mock(async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid token"}}',
    }))
    globalThis.fetch = mockFetch as any

    const provider = createGeminiProvider({ accessToken: "bad-token" })
    const model = provider.languageModel("gemini-2.5-flash")

    await expect(
      model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          },
        ],
      }),
    ).rejects.toThrow("Gemini API error: 401")

    globalThis.fetch = originalFetch
  })
})
