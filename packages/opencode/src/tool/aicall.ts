import * as Tool from "./tool"
import DESCRIPTION from "./aicall.txt"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Schema } from "effect"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { generateText } from "ai"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "tool.aicall" })

const id = "aicall"
const policy = "ai-call"

export function requestEnvelope(
  model: Pick<Provider.Model, "providerID" | "id" | "api" | "parameters" | "model_type" | "cost" | "limit">,
  userText: string,
) {
  const paid = (model.cost?.input ?? 0) > 0 || (model.cost?.output ?? 0) > 0
  return [
    "Direct AI call request:",
    `provider: ${model.providerID}`,
    `model: ${model.id}`,
    `api model: ${model.api.id}`,
    `sdk: ${model.api.npm ?? "built-in"}`,
    `endpoint: ${model.api.url ?? "provider default"}`,
    `type: ${model.model_type ?? "chat"}`,
    `parameters: ${model.parameters ? `${model.parameters}B` : "unknown"}`,
    paid ? `cost: $${model.cost?.input}/$${model.cost?.output} per Mtok` : "cost: free",
    `context: ${model.limit?.context ?? "unknown"} tokens`,
    "system: none (isolated aicall)",
    "tools: none (isolated aicall)",
    `user context: ${userText.length} chars`,
  ].join("\n")
}

const codeExts = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".go", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala",
  ".rb", ".php", ".sh", ".bash", ".zsh", ".sql", ".r", ".jl",
])

export const Parameters = Schema.Struct({
  prompt: Schema.String.annotate({ description: "The instructions or prompt to send to the LLM" }),
  files: Schema.optional(
    Schema.Array(Schema.String),
  ).annotate({ description: "File paths to read and include as context before the prompt" }),
  output_file: Schema.optional(Schema.String).annotate({
    description: "Save the response to this file instead of returning inline",
  }),
  model: Schema.optional(Schema.String).annotate({ description: "Model override. Uses session default if omitted" }),
  provider: Schema.optional(Schema.String).annotate({
    description: "Provider override. Uses session default if omitted",
  }),
  temperature: Schema.optional(Schema.Number).annotate({
    description: "Sampling temperature (0-2). Lower is more deterministic",
  }),
  top_p: Schema.optional(Schema.Number).annotate({ description: "Nucleus sampling mass (0-1)" }),
  top_k: Schema.optional(Schema.Number).annotate({ description: "Top-K sampling" }),
  max_tokens: Schema.optional(Schema.Number).annotate({ description: "Maximum output tokens" }),
  presence_penalty: Schema.optional(Schema.Number).annotate({ description: "Presence penalty (-2 to 2)" }),
  frequency_penalty: Schema.optional(Schema.Number).annotate({ description: "Frequency penalty (-2 to 2)" }),
  seed: Schema.optional(Schema.Number).annotate({ description: "Seed for (mostly) deterministic sampling" }),
})

type Metadata = {
  model: { providerID: string; modelID: string }
}

export const AiCallTool = Tool.define(
  id,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context

          // Permission check
          yield* ctx.ask({
            permission: policy,
            patterns: [params.prompt],
            always: ["*"],
            metadata: {
              files: params.files ?? [],
              output_file: params.output_file,
            },
          })

          // Resolve model
          const model = yield* (params.model || params.provider
            ? Effect.gen(function* () {
                const defaultModel = yield* provider.defaultModel()
                const rawProviderID = params.provider ?? defaultModel.providerID
                const providerID = ProviderID.make(rawProviderID)
                const modelID = ModelID.make(params.model ?? defaultModel.modelID)
                return yield* provider.getModel(providerID, modelID)
              })
            : Effect.gen(function* () {
                // Auto-select: prefer free models (cost 0/0, declared in the
                // registry) with the largest context, then BigPickle, then the
                // session default. Chat models only — embedding/rerank entries
                // cannot serve a text call. A 10B model is not asked for
                // miracles: size is reported in the envelope so the caller can
                // calibrate expectations.
                const providers = yield* provider.list()
                const chatModels = Object.values(providers).flatMap((p) =>
                  Object.values(p.models).filter(
                    (m) => m.model_type !== "embedding" && m.model_type !== "rerank",
                  ),
                )
                const free = chatModels
                  .filter(
                    (m) =>
                      m.cost !== undefined && (m.cost.input ?? 0) === 0 && (m.cost.output ?? 0) === 0,
                  )
                  .sort((a, b) => b.limit.context - a.limit.context)
                if (free[0]) return free[0]
                // Free tier anchor: the actual id is "big-pickle" (dashed) —
                // the old "bigpickle" needle never matched and silently fell
                // through to the (possibly paid) session default.
                for (const p of Object.values(providers)) {
                  const found = Object.values(p.models).find((m) =>
                    m.id.toLowerCase().includes("big-pickle"),
                  )
                  if (found) return found
                }
                const defaultModel = yield* provider.defaultModel()
                return yield* provider.getModel(defaultModel.providerID, defaultModel.modelID)
              }))

          // Build user message: file contents (if any) + prompt
          let userText = ""
          if (params.files) {
            for (const filepath of params.files) {
              const resolved = path.isAbsolute(filepath)
                ? filepath
                : path.join(ins.directory, filepath)
              try {
                const content = yield* fs.readFileString(resolved)
                userText += `\n\n--- BEGIN FILE: ${filepath} ---\n${content}\n--- END FILE: ${filepath} ---`
              } catch (e) {
                log.debug("file read failed for aicall", { filepath, error: e })
                userText += `\n\n--- FILE NOT FOUND: ${filepath} ---`
              }
            }
          }
          userText += `\n\n${params.prompt}`

          // Direct LLM call — no session, no system prompt, no tools.
          // This is a prose-only, isolated cognition accelerator.
          const language = yield* provider.getLanguage(model)
          const result = yield* Effect.tryPromise(() =>
            generateText({
              model: language,
              messages: [{ role: "user", content: userText }],
              ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
              ...(params.top_p !== undefined ? { topP: params.top_p } : {}),
              ...(params.top_k !== undefined ? { topK: params.top_k } : {}),
              ...(params.max_tokens !== undefined ? { maxOutputTokens: params.max_tokens } : {}),
              ...(params.presence_penalty !== undefined ? { presencePenalty: params.presence_penalty } : {}),
              ...(params.frequency_penalty !== undefined ? { frequencyPenalty: params.frequency_penalty } : {}),
              ...(params.seed !== undefined ? { seed: params.seed } : {}),
            }),
          )

          const output = result.text
          const envelope = requestEnvelope(model, userText)

          // Optionally save to file
          if (params.output_file) {
            const outPath = path.isAbsolute(params.output_file)
              ? params.output_file
              : path.join(ins.directory, params.output_file)

            // Guard: if output_file looks like source code but content
            // is markdown (model returned summary instead of code), reject.
            const ext = path.extname(params.output_file).toLowerCase()
            if (codeExts.has(ext)) {
              const stripped = output.trimStart()
              // Check for a single code fence wrapping the entire output first
              // (model often wraps generated code in ```lang ... ```).
              // Must check BEFORE markdown detection: a leading ``` triggers
              // the markdown regex, which would reject valid fenced code.
              const fenceMatch = stripped.match(/^```[\w]*\n([\s\S]*?)\n```\s*$/)
              const content = fenceMatch ? fenceMatch[1] : stripped
              // Narrow heading match to ##+ (level 2+) to avoid false-positiving
              // on Python/Ruby/Shell comments starting with "# " (level-1 heading).
              const looksLikeMarkdown =
                /^(?:#{2,6}\s|```|[*-]\s|>\s|\d+\.\s|\[.+\]\(.+\))/.test(content.trimStart()) ||
                /^(?:The\s+refactoring\s+is\s+complete|Here(?:'s|\s+is)\s+(?:a\s+)?summary|##\s+Summary)/i.test(content.trimStart())
              if (looksLikeMarkdown) {
                return {
                  title: `aicall → ${params.output_file} REJECTED`,
                  metadata: {
                    model: { providerID: model.providerID, modelID: model.id },
                  },
                  output: `${envelope}\n\nREJECTED: output_file "${params.output_file}" has a code extension but the model returned markdown/prose instead of source code. The file was NOT overwritten. First 200 chars of rejected output:\n${output.slice(0, 200)}`,
                }
              }
              if (fenceMatch) {
                yield* fs.writeWithDirs(outPath, content)
                return {
                  title: `aicall → ${params.output_file}`,
                  metadata: {
                    model: { providerID: model.providerID, modelID: model.id },
                  },
                  output: `${envelope}\n\nResponse saved to ${params.output_file} (${content.length} chars, code fence stripped)`,
                }
              }
            }

            yield* fs.writeWithDirs(outPath, output)
            return {
              title: `aicall → ${params.output_file}`,
              metadata: {
                model: { providerID: model.providerID, modelID: model.id },
              },
              output: `${envelope}\n\nResponse saved to ${params.output_file} (${output.length} chars)`,
            }
          }

          return {
            title: `aicall: ${params.prompt.slice(0, 40)}${params.prompt.length > 40 ? "..." : ""}`,
            metadata: {
              model: { providerID: model.providerID, modelID: model.id },
            },
            output: `${envelope}\n\n${output}`,
          }
        }).pipe(Effect.orDie),
    }
  }),
  policy,
)
