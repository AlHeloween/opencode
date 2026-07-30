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
                // Auto-select: prefer BigPickle, fall back to session default
                const providers = yield* provider.list()
                for (const p of Object.values(providers)) {
                  const found = Object.values(p.models).find((m) =>
                    m.id.toLowerCase().includes("bigpickle"),
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
            }),
          )

          const output = result.text

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
                  output: `REJECTED: output_file "${params.output_file}" has a code extension but the model returned markdown/prose instead of source code. The file was NOT overwritten. First 200 chars of rejected output:\n${output.slice(0, 200)}`,
                }
              }
              if (fenceMatch) {
                yield* fs.writeWithDirs(outPath, content)
                return {
                  title: `aicall → ${params.output_file}`,
                  metadata: {
                    model: { providerID: model.providerID, modelID: model.id },
                  },
                  output: `Response saved to ${params.output_file} (${content.length} chars, code fence stripped)`,
                }
              }
            }

            yield* fs.writeWithDirs(outPath, output)
            return {
              title: `aicall → ${params.output_file}`,
              metadata: {
                model: { providerID: model.providerID, modelID: model.id },
              },
              output: `Response saved to ${params.output_file} (${output.length} chars)`,
            }
          }

          return {
            title: `aicall: ${params.prompt.slice(0, 40)}${params.prompt.length > 40 ? "..." : ""}`,
            metadata: {
              model: { providerID: model.providerID, modelID: model.id },
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
  policy,
)
