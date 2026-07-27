import * as Tool from "./tool"
import DESCRIPTION from "./aicall.txt"
import { Session } from "@/session/session"
import { SessionID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { InstanceState } from "@/effect/instance-state"
import { Effect, Schema } from "effect"
import { Provider } from "@/provider/provider"
import { ProviderID, ModelID } from "@/provider/schema"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

const id = "aicall"
const policy = "ai-call"

export interface AiCallPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

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
    description: "Sampling temperature (0-2). Uses agent default if omitted",
  }),
  max_tokens: Schema.optional(Schema.Number).annotate({
    description: "Maximum output tokens. Uses agent default if omitted",
  }),
})

type Metadata = {
  sessionId: string
  model: { providerID: string; modelID: string }
}

export const AiCallTool = Tool.define(
  id,
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const provider = yield* Provider.Service
    const fs = yield* AppFileSystem.Service
    const agentSvc = yield* Agent.Service

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

          // Resolve model. No override → auto-select BigPickle (best default).
          // Explicit model/provider params bypass auto-selection.
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

          // Create child session
          const subSession = yield* sessions.create({
            parentID: ctx.sessionID,
            title: `aicall: ${params.prompt.slice(0, 80)}`,
          })

          const ops = ctx.extra?.promptOps as AiCallPromptOps | undefined
          if (!ops) {
            return {
              title: "aicall failed",
              output: "aicall requires promptOps in tool context (not available in this session mode)",
              metadata: { sessionId: "(none)", model: { providerID: "", modelID: "" } },
            }
          }

          // Build parts: file contents + prompt
          const parts: Array<{ type: "text"; text: string }> = []

          if (params.files) {
            for (const filepath of params.files) {
              const resolved = path.isAbsolute(filepath)
                ? filepath
                : path.join(ins.directory, filepath)
              try {
                const content = yield* fs.readFileString(resolved)
                parts.push({
                  type: "text",
                  text: `\n\n--- BEGIN FILE: ${filepath} ---\n${content}\n--- END FILE: ${filepath} ---`,
                })
              } catch {
                parts.push({
                  type: "text",
                  text: `\n\n--- FILE NOT FOUND: ${filepath} ---`,
                })
              }
            }
          }

          parts.push({ type: "text", text: params.prompt })

          // Call LLM with tools disabled (prose-only response)
          const result = yield* ops.prompt({
            sessionID: subSession.id,
            model: { modelID: model.id, providerID: model.providerID },
            agent: ctx.agent,
            tools: {}, // No tools — prose only
            parts,
          })

          const output = result.parts
            .filter((p): p is MessageV2.TextPart => p.type === "text")
            .map((p) => p.text)
            .join("\n")

          // Optionally save to file
          if (params.output_file) {
            const outPath = path.isAbsolute(params.output_file)
              ? params.output_file
              : path.join(ins.directory, params.output_file)
            yield* fs.writeWithDirs(outPath, output)
            return {
              title: `aicall → ${params.output_file}`,
              metadata: {
                sessionId: subSession.id,
                model: { providerID: model.providerID, modelID: model.id },
              },
              output: `Response saved to ${params.output_file} (${output.length} chars)`,
            }
          }

          return {
            title: `aicall: ${params.prompt.slice(0, 40)}${params.prompt.length > 40 ? "..." : ""}`,
            metadata: {
              sessionId: subSession.id,
                model: { providerID: model.providerID, modelID: model.id },
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
  policy,
)
