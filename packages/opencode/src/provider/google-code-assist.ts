import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2Content,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
  LanguageModelV2Usage,
} from "@ai-sdk/provider"
import * as Log from "@opencode-ai/core/util/log"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

const log = Log.create({ service: "provider.gemini" })

const GEMINI_API_ENDPOINT = process.env.GEMINI_API_ENDPOINT || "https://generativelanguage.googleapis.com"
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || "v1beta"

const USER_AGENT = `GeminiCLI/${InstallationVersion}/${process.platform}; ${process.arch}`

interface GeminiProviderOptions {
  accessToken: string
}

interface GenerateContentRequest {
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
  systemInstruction?: { role: string; parts: Array<{ text: string }> }
  generationConfig?: {
    temperature?: number
    topP?: number
    topK?: number
    candidateCount?: number
    maxOutputTokens?: number
    stopSequences?: string[]
  }
  tools?: Array<{ functionDeclarations: Array<object> }>
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts: Array<{ text: string; functionCall?: any } | { functionResponse?: any }> }
    finishReason?: string
    safetyRatings?: Array<{ category: string; probability: string }>
    tokenCount?: number
  }>
  promptFeedback?: {
    blockReason?: string
    safetyRatings?: Array<{ category: string; probability: string }>
  }
}

const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "User-Agent": USER_AGENT,
  "x-goog-api-client": `gl-node/${process.version.slice(1)}`,
}

export function createGeminiProvider(options: GeminiProviderOptions) {
  const { accessToken } = options

  function buildHeaders(): Record<string, string> {
    return {
      ...COMMON_HEADERS,
      Authorization: `Bearer ${accessToken}`,
    }
  }

  class GeminiLanguageModel implements LanguageModelV2 {
    readonly specificationVersion = "v2"
    readonly provider = "google"
    readonly supportedUrls: Record<string, RegExp[]> = {}

    constructor(public readonly modelId: string) {}

    private buildUrl(model: string, streaming = false): string {
      const streamPart = streaming ? ":streamGenerateContent" : ":generateContent"
      return `${GEMINI_API_ENDPOINT}/${GEMINI_API_VERSION}/models/${model}${streamPart}`
    }

    private buildRequest(
      prompt: LanguageModelV2CallOptions["prompt"],
      config: LanguageModelV2CallOptions,
    ): GenerateContentRequest {
      const system = prompt.find((p) => p.role === "system")
      const contents = prompt
        .filter((p) => p.role === "user" || p.role === "assistant")
        .map((p) => ({
          role: p.role === "assistant" ? "model" : "user",
          parts: p.content.filter((c) => c.type === "text").map((c) => ({ text: (c as any).text })),
        }))

      const request: GenerateContentRequest = {
        contents,
      }

      if (system) {
        request.systemInstruction = {
          role: "user",
          parts: [{ text: system.content }],
        }
      }

      request.generationConfig = {
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature,
        topP: config.topP,
        stopSequences: config.stopSequences,
      }

      if (config.tools && config.tools.length > 0) {
        request.tools = config.tools
          .filter((tool) => "type" in tool && tool.type === "function")
          .map((tool) => ({
            functionDeclarations: [
              {
                name: tool.name,
                description: tool.description,
                parameters: (tool as any).inputSchema as object,
              },
            ],
          }))
      }

      return request
    }

    private parseResponse(data: GenerateContentResponse): {
      content: LanguageModelV2Content[]
      finishReason: LanguageModelV2FinishReason
      usage: LanguageModelV2Usage
    } {
      const content: LanguageModelV2Content[] = []
      let finishReason: LanguageModelV2FinishReason = "unknown"
      let outputTokens = 0

      if (data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0]
        if (candidate.content?.parts) {
          for (const part of candidate.content.parts) {
            if ("text" in part && part.text) {
              content.push({ type: "text", text: part.text })
            } else if ("functionCall" in part && part.functionCall) {
              content.push({
                type: "tool-call",
                toolCallId: crypto.randomUUID(),
                toolName: part.functionCall.name,
                input: JSON.stringify(part.functionCall.args ?? {}),
              })
            }
          }
        }
        outputTokens = candidate.tokenCount ?? 0

        switch (candidate.finishReason) {
          case "STOP":
            finishReason = "stop"
            break
          case "MAX_TOKENS":
            finishReason = "length"
            break
          case "SAFETY":
            finishReason = "content-filter"
            break
          case "RECITATION":
            finishReason = "content-filter"
            break
          case "TOOL_CODE":
            finishReason = "tool-calls"
            break
          default:
            finishReason = "unknown"
        }
      }

      if (data.promptFeedback?.blockReason) {
        finishReason = "content-filter"
      }

      const usage: LanguageModelV2Usage = {
        inputTokens: 0,
        outputTokens: outputTokens,
        totalTokens: outputTokens,
      }

      return { content, finishReason, usage }
    }

    async doGenerate(options: LanguageModelV2CallOptions): Promise<{
      content: Array<LanguageModelV2Content>
      finishReason: LanguageModelV2FinishReason
      usage: LanguageModelV2Usage
      warnings: any[]
    }> {
      const url = this.buildUrl(this.modelId, false)
      const request = this.buildRequest(options.prompt, options)

      const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        const text = await response.text()
        log.warn("Gemini API error", { status: response.status, body: text })
        throw new Error(`Gemini API error: ${response.status} ${text}`)
      }

      const data = await response.json()
      const parsed = this.parseResponse(data)

      return {
        ...parsed,
        warnings: [],
      }
    }

    async doStream(options: LanguageModelV2CallOptions): Promise<{
      stream: ReadableStream<LanguageModelV2StreamPart>
    }> {
      const url = this.buildUrl(this.modelId, true)
      const request = this.buildRequest(options.prompt, options)

      const response = await fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        const text = await response.text()
        log.warn("Gemini API stream error", { status: response.status, body: text })
        throw new Error(`Gemini API stream error: ${response.status} ${text}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("No response body for streaming")
      }

      const stream = new ReadableStream<LanguageModelV2StreamPart>({
        async start(controller) {
          const decoder = new TextDecoder()
          let buffer = ""
          let usage: LanguageModelV2Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
          let finishReason: LanguageModelV2FinishReason = "unknown"

          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() || ""

              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  const jsonStr = line.substring(6)
                  try {
                    const chunk = JSON.parse(jsonStr) as GenerateContentResponse
                    if (chunk.candidates && chunk.candidates.length > 0) {
                      const candidate = chunk.candidates[0]
                      if (candidate.content?.parts) {
                        for (const part of candidate.content.parts) {
                          if ("text" in part && part.text) {
                            controller.enqueue({ type: "text-delta", id: crypto.randomUUID(), delta: part.text })
                          }
                        }
                      }
                      finishReason =
                        candidate.finishReason === "STOP"
                          ? "stop"
                          : candidate.finishReason === "MAX_TOKENS"
                            ? "length"
                            : "unknown"
                    }
                  } catch (e) {
                    log.warn("Failed to parse stream chunk", { chunk: jsonStr, error: e })
                  }
                }
              }
            }

            controller.enqueue({ type: "finish", finishReason, usage })
          } catch (error) {
            controller.error(error)
          } finally {
            controller.close()
          }
        },
      })

      return { stream }
    }
  }

  return {
    languageModel(modelId: string): LanguageModelV2 {
      return new GeminiLanguageModel(modelId)
    },
  }
}
