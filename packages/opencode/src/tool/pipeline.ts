import { Effect, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Tool } from "@/tool/tool"
import { Session } from "@/session/session"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { MessageID } from "../session/schema"
import type { TaskPromptOps } from "./task"

const ContextMode = Schema.Literals(["full", "summary", "fields", "maxTokens"])

const ContextConfig = Schema.Struct({
  from: Schema.optional(Schema.Union([Schema.Number, Schema.Array(Schema.Number)])).annotate({
    description: "Step index(es) to get context from. Default: previous step.",
  }),
  mode: Schema.optional(ContextMode).annotate({
    description: "How to pass context: full (default), summary, fields, maxTokens",
  }),
  fields: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "When mode=fields, extract lines containing these field names",
  }),
  maxTokens: Schema.optional(Schema.Number).annotate({
    description: "When mode=maxTokens or summary, limit output to this many tokens",
  }),
})

export const Parameters = Schema.Struct({
  steps: Schema.Array(
    Schema.Struct({
      agent: Schema.String.annotate({
        description: "Agent type to use: general, explore, coder, researcher, media",
      }),
      description: Schema.String.annotate({
        description: "Short (3-5 word) description of this step",
      }),
      prompt: Schema.String.annotate({
        description: "Task for this agent to perform",
      }),
      variant: Schema.optional(Schema.String).annotate({
        description: "Model variant/reasoning effort: low, medium, high, max",
      }),
      context: Schema.optional(ContextConfig).annotate({
        description: "How to receive context from previous steps",
      }),
    }),
  ).annotate({
    description:
      "Ordered list of agent steps. Output of step N is appended as context for step N+1.",
  }),
})

const DESCRIPTION = `Chain multiple sub-agents sequentially. Each agent's output feeds as context to the next.

Use this tool for complex tasks that require a sequence of specialized agents:
- Research -> Code: researcher gathers evidence, coder implements
- Explore -> Plan: explore finds relevant files, general plans the approach
- Media -> Verify: media generates output, researcher checks results

The agent types available are the same as the task tool: general, explore, coder, researcher, media.

Each step runs in an isolated sub-session. The text output from step N is prepended as "Context from previous step" to step N+1's prompt.`

interface PipelineStepResult {
  step: number
  agent: string
  description: string
  output: string
  sessionID: string
}

interface ContextConfigType {
  from?: number | number[] | readonly number[]
  mode?: "full" | "summary" | "fields" | "maxTokens"
  fields?: string[] | readonly string[]
  maxTokens?: number
}

function prepareContext(
  contextConfig: ContextConfigType | undefined,
  stepIndex: number,
  allResults: PipelineStepResult[],
  originalPrompt: string,
): string {
  // First step always gets original prompt
  if (stepIndex === 0) return originalPrompt

  // No context config → use default (previous step output)
  if (!contextConfig) {
    const prev = allResults[stepIndex - 1]
    return `${originalPrompt}\n\n## Context from previous step:\n${prev.output}`
  }

  // Determine source results
  const fromValue = contextConfig.from
  let sourceIndexes: number[]
  if (fromValue === undefined) {
    sourceIndexes = [stepIndex - 1]
  } else if (Array.isArray(fromValue)) {
    sourceIndexes = (fromValue as readonly number[]).filter((x): x is number => typeof x === "number")
  } else {
    sourceIndexes = [fromValue as number]
  }

  const sourceResults = sourceIndexes
    .filter(i => i >= 0 && i < allResults.length)
    .map(i => allResults[i])

  if (sourceResults.length === 0) {
    return `${originalPrompt}\n\n## Context from previous step:\n(No previous results available)`
  }

  // Apply context mode
  switch (contextConfig.mode) {
    case "summary":
      return `${originalPrompt}\n\n## Summary of previous steps:\n${summarizeContext(sourceResults, contextConfig.maxTokens)}`

    case "fields":
      return `${originalPrompt}\n\n## Extracted fields:\n${extractFields(sourceResults, [...(contextConfig.fields ?? [])])}`

    case "maxTokens":
      return `${originalPrompt}\n\n## Context from previous steps (truncated):\n${truncateContext(sourceResults, contextConfig.maxTokens ?? 4000)}`

    case "full":
    default:
      return `${originalPrompt}\n\n## Context from previous steps:\n${sourceResults.map(r => `### ${r.agent} — ${r.description}\n${r.output}`).join("\n\n")}`
  }
}

function summarizeContext(results: PipelineStepResult[], maxTokens?: number): string {
  // Take first 500 chars of each result as a simple summary
  const combined = results.map(r => `${r.agent}: ${r.output.slice(0, 500)}`).join("\n\n")
  return maxTokens ? combined.slice(0, maxTokens * 4) : combined
}

function extractFields(results: PipelineStepResult[], fields: string[]): string {
  return results.flatMap(r =>
    r.output.split("\n").filter(line =>
      fields.some(f => line.toLowerCase().includes(f.toLowerCase()))
    )
  ).join("\n")
}

function truncateContext(results: PipelineStepResult[], maxTokens: number): string {
  const maxChars = maxTokens * 4
  const combined = results.map(r => `${r.agent}: ${r.output}`).join("\n\n")
  return combined.slice(0, maxChars)
}

export const PipelineTool = Tool.define(
  "pipeline",
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
          if (!ops)
            return {
              title: "Pipeline",
              metadata: { pipeline: [] },
              output:
                "Pipeline error: promptOps not available in tool context.",
            }

          // Capture ops ref for closure safety
          const promptOps = ops
          const results: PipelineStepResult[] = []

          const cfg = yield* config.get()

          for (const [i, step] of params.steps.entries()) {
            const stepAgent = yield* agents
              .get(step.agent)
              .pipe(Effect.orElseSucceed(() => undefined))

            if (!stepAgent) {
              results.push({
                step: i,
                agent: step.agent,
                description: step.description,
                output: `Error: unknown agent type "${step.agent}"`,
                sessionID: "",
              })
              continue
            }

            // Use new context preparation with configurable modes
            const augmentedPrompt = prepareContext(step.context, i, results, step.prompt)

            const subSession = yield* sessions.create({
              parentID: ctx.sessionID,
              title: `${step.description} (@${stepAgent.name} subagent)`,
            })

            const defaultModel = yield* provider.defaultModel()
            const model = stepAgent.model ?? defaultModel

            const parts = yield* promptOps.resolvePromptParts(augmentedPrompt)

            const cancelEffect = promptOps.cancel(subSession.id)
            const cancelBridge = yield* EffectBridge.make()

            function onAbort() {
              cancelBridge.fork(cancelEffect)
            }

            ctx.abort.addEventListener("abort", onAbort)

            const dispose = Effect.sync(() => {
              ctx.abort.removeEventListener("abort", onAbort)
            })

            const messageID = MessageID.ascending()

            const promptResult = yield* promptOps
              .prompt({
                messageID,
                sessionID: subSession.id,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: stepAgent.name,
                variant: step.variant,  // NEW: pass variant per step
                tools: {
                  todowrite: false,
                  task: false,
                },
                parts,
              })
              .pipe(
                Effect.matchEffect({
                  onSuccess: (result) =>
                    Effect.succeed({ type: "ok" as const, result }),
                  onFailure: (error) =>
                    Effect.succeed({
                      type: "error" as const,
                      message: String(error),
                    }),
                }),
                Effect.ensuring(dispose),
              )

            const outputText =
              promptResult.type === "ok"
                ? (promptResult.result.parts.findLast(
                    (item) => item.type === "text",
                  ) as { text?: string } | undefined)?.text ?? ""
                : `Pipeline step ${i} failed: ${promptResult.message}`

            results.push({
              step: i,
              agent: stepAgent.name,
              description: step.description,
              output: outputText,
              sessionID: subSession.id,
            })
          }

          const output = [
            `Pipeline completed: ${results.length} steps`,
            "",
            ...results.map(
              (r, i) =>
                `## Step ${i + 1}: ${r.agent} — ${r.description}\n${r.output.slice(0, 1000)}${r.output.length > 1000 ? "\n... (truncated)" : ""}`,
            ),
          ].join("\n")

          return {
            title: `Pipeline: ${params.steps.length} steps`,
            metadata: { pipeline: results },
            output,
          }
        }),
    }
  }),
)

export * as Pipeline from "./pipeline"
