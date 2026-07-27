import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import * as EffectZod from "@/util/effect-zod"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Plugin } from "@/plugin"
import { Tool, canonicalName } from "@/tool/tool"
import type { TaskPromptOps } from "@/tool/task"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"
import { ModelID } from "@/provider/schema"

const log = Log.create({ service: "session.tools" })
const policyNames = new WeakMap<Record<string, AITool>, Map<string, string>>()

export function policyName(tools: Record<string, AITool>, name: string) {
  return policyNames.get(tools)?.get(name) ?? name
}

/** @deprecated use policyName; retained for internal compatibility. */
export const originalName = policyName

export function preservePolicyNames(source: Record<string, AITool>, target: Record<string, AITool>) {
  policyNames.set(target, new Map(Object.keys(target).map((name) => [name, policyName(source, name)])))
  return target
}

/** @deprecated use preservePolicyNames; retained for internal compatibility. */
export const preserveOriginalNames = preservePolicyNames

export const resolve = Effect.fn("SessionTools.resolve")(function* (input: {
  agent: Agent.Info
  providerAgent?: Agent.Info
  model: Provider.Model
  session: Session.Info
  processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
  promptOps: TaskPromptOps
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const names = new Map<string, string>()
  const run = yield* EffectBridge.make()
  const plugin = yield* Plugin.Service
  const permission = yield* Permission.Service
  const registry = yield* ToolRegistry.Service
  const mcp = yield* MCP.Service
  const truncate = yield* Truncate.Service
  const disabled = (toolID: string) => {
    const permission = ["edit", "write", "apply_patch"].includes(toolID) ? "edit" : toolID
    return (
      Permission.evaluate(permission, "*", input.agent.permission).action === "deny" ||
      Permission.evaluate(permission, "*", input.session.permission ?? []).action === "deny"
    )
  }

  const rejected = (toolID: string, callID: string) =>
    Effect.gen(function* () {
      const output = {
        title: "Tool unavailable",
        metadata: { mode: input.agent.name, tool: toolID },
        output: `Tool \"${toolID}\" is unavailable in ${input.agent.name} mode.`,
      }
      yield* input.processor.completeToolCall(callID, output)
      return output
    })

  const context = (args: Record<string, unknown>, options: ToolExecutionOptions<any>): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps: input.promptOps },
    agent: input.agent.name,
    agentInfo: input.agent,
    messages: input.messages,
    metadata: (val: { title?: string; metadata?: Record<string, unknown>; output?: string }) =>
      input.processor.updateToolCall(options.toolCallId, (match) => {
        if (!["running", "pending"].includes(match.state.status)) return match
        return {
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            output: val.output ?? match.state.status === "running" ? (match.state as any).output : undefined,
            status: "running",
            input: args,
            time: { start: Date.now() },
          },
        }
      }),
    ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
      permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie),
  })

  const register = (name: string, value: AITool, policy: string) => {
    if (!name) {
      log.warn("bug: provider tool name has no ASCII alphanumerics", { policy })
      throw new Error(`Provider tool with policy "${policy}" has no ASCII alphanumeric name`)
    }
    if (!tools[name]) {
      tools[name] = value
      names.set(name, policy)
      return
    }
    log.warn("bug: provider tool-name collision", { canonical: name, policy })
    throw new Error(`Provider tool name collision for "${name}" from "${policy}"`)
  }

  for (const item of yield* registry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.providerAgent ?? input.agent,
  })) {
    const name = canonicalName(item.id)
    const schema = ProviderTransform.schema(input.model, EffectZod.toJsonSchema(item.parameters))
    register(name, tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            if (disabled(item.policy)) return yield* rejected(item.id, options.toolCallId)
            const ctx = context(args, options)
            yield* plugin.trigger(
              "tool.execute.before",
              { tool: item.policy, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            const result = yield* item.execute(args, ctx)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* plugin.trigger(
              "tool.execute.after",
              { tool: item.policy, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            // Always complete the tool call from the execute callback — the
            // "tool-result" stream event may not be emitted if the stream was
            // interrupted or the AI SDK skipped it. completeToolCall is
            // idempotent (guards against double-completion).
            yield* input.processor.completeToolCall(options.toolCallId, output)
            return output
          }),
        )
      },
    }), item.policy)
  }

  // Provider-visible tools stay stable across native mode transitions; runtime
  // permissions still guard every execution below.
  const mcpTools = yield* mcp.tools()
  for (const [key, item] of Object.entries(mcpTools)) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const name = canonicalName(key)
    const transformed = ProviderTransform.schema(input.model, schema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = (args, opts) =>
      run.promise(
        Effect.gen(function* () {
          if (disabled(key)) return yield* rejected(key, opts.toolCallId)
          const ctx = context(args, opts)
          yield* plugin.trigger(
            "tool.execute.before",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
            { args },
          )
          yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
          const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.promise(() =>
            execute(args, opts),
          )
          yield* plugin.trigger(
            "tool.execute.after",
            { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
            result,
          )

          const textParts: string[] = []
          const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
          for (const contentItem of result.content) {
            if (contentItem.type === "text") textParts.push(contentItem.text)
            else if (contentItem.type === "image") {
              attachments.push({
                type: "file",
                mime: contentItem.mimeType,
                url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
              })
            } else if (contentItem.type === "resource") {
              const { resource } = contentItem
              if (resource.text) textParts.push(resource.text)
              if (resource.blob) {
                attachments.push({
                  type: "file",
                  mime: resource.mimeType ?? "application/octet-stream",
                  url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                  filename: resource.uri,
                })
              }
            }
          }

          const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
          const metadata = {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          }

          const output = {
            title: "",
            metadata,
            output: truncated.content,
            attachments: attachments.map((attachment) => ({
              ...attachment,
              id: PartID.ascending(),
              sessionID: ctx.sessionID,
              messageID: input.processor.message.id,
            })),
            content: result.content,
          }
          // Always complete — "tool-result" may not fire if stream interrupted.
          yield* input.processor.completeToolCall(opts.toolCallId, output)
          return output
        }),
      )
    register(name, item, key)
  }

  policyNames.set(tools, names)
  return tools
})

export * as SessionTools from "./tools"
