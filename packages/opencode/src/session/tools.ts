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
import { Tool, canonicalName, TOOL_ALIASES } from "@/tool/tool"
import type { TaskPromptOps } from "@/tool/task"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import * as Session from "./session"
import { SessionProcessor } from "./processor"
import { PartID } from "./schema"
import * as Log from "@opencode-ai/core/util/log"
import { EffectBridge } from "@/effect/bridge"
import { ModelID } from "@/provider/schema"
import { Wildcard } from "@/util/wildcard"
import { Constitution } from "./constitution"
import { SessionID } from "./schema"

const log = Log.create({ service: "session.tools" })

/** Wire-frozen MCP tool entry: everything the provider sees, nothing else. */
type McpWire = {
  key: string
  name: string
  description: AITool["description"]
  schema: Parameters<typeof jsonSchema>[0]
}

type McpEra = { sig: string; wire: McpWire[] }

/** Per session+model era snapshots of the MCP wire catalog (process-local;
 *  session IDs are globally unique, entries are cleared on era boundaries). */
const mcpEraStore = new Map<string, McpEra>()
const MCP_ERA_STORE_MAX = 512

/** Era boundary (compact / system-version bump): refresh the MCP wire catalog. */
export function invalidateMCPEra(sessionID: SessionID): void {
  const prefix = `${sessionID}\0`
  for (const key of [...mcpEraStore.keys()]) {
    if (key.startsWith(prefix)) mcpEraStore.delete(key)
  }
}

function mcpEraGet(key: string): McpEra | undefined {
  return mcpEraStore.get(key)
}

function mcpEraSet(key: string, value: McpEra): void {
  mcpEraStore.delete(key)
  mcpEraStore.set(key, value)
  while (mcpEraStore.size > MCP_ERA_STORE_MAX) {
    const first = mcpEraStore.keys().next().value
    if (first === undefined) break
    mcpEraStore.delete(first)
  }
}

export function mcpLiveSig(tools: Record<string, AITool>): string {
  return Object.keys(tools)
    .toSorted()
    .map((key) => {
      const item = tools[key]
      let schemaLen = 0
      try {
        schemaLen = JSON.stringify(asSchema(item.inputSchema).jsonSchema).length
      } catch {
        schemaLen = 0
      }
      const descLen = typeof item.description === "string" ? item.description.length : 0
      return `${key}:${schemaLen}:${descLen}`
    })
    .join("\u0000")
}
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
  /** Canonical tool names disabled via user.tools[k] === false — runtime-deny
   *  only; the catalog on the wire stays complete (KV prefix stability). */
  userDisabled?: ReadonlySet<string>
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
  /**
   * Runtime ACL only — must not reshape the provider tool list.
   * Tool schemas stay byte-stable across native mode switches (KV cache);
   * mode/role lives in system + mode reminder; this gate refuses execution.
   */
  const denied = (toolID: string) => {
    // user.tools[k] === false: runtime-deny, never a wire reshape.
    if (input.userDisabled?.has(canonicalName(toolID))) return true
    const keys = new Set<string>([
      toolID,
      ...(["edit", "write", "apply_patch"].includes(toolID) ? (["edit"] as const) : []),
      ...(toolID === "dbread" || toolID === "db-read" ? (["dbread", "db-read"] as const) : []),
    ])
    for (const key of keys) {
      const perm = ["edit", "write", "apply_patch"].includes(key) ? "edit" : key

      // Agent ruleset: a wildcard deny (e.g. edit * → deny) should not block
      // when the same ruleset also has a path-scoped allow for the edit family
      // (e.g. plan agent: plans/* → allow). The tool's ctx.ask gate enforces
      // per-path with the real file path. Other permissions (read, bash, etc.)
      // keep their wildcard deny — scoped allows there (e.g. *.env=ask) are
      // for ctx.ask enforcement only, not for bypassing Gate A.
      const agentEval = Permission.evaluate(perm, "*", input.agent.permission)
      if (agentEval.action === "deny") {
        // A wildcard deny should not block when the same ruleset also has a
        // path-scoped allow for the plan-mode plans/ exception. Only the edit
        // family (edit/write/apply_patch) uses path-scoped allows to carve out
        // plans/* from an otherwise flat deny. Other permissions (e.g. read
        // with *.env=ask) keep their scoped allows for ctx.ask enforcement
        // only — the wildcard deny at Gate A still stands.
        const hasScopedAllow =
          perm === "edit" &&
          input.agent.permission
            .filter((rule) => Wildcard.match(perm, rule.permission))
            .some((rule) => rule.pattern !== "*" && (rule.action === "allow" || rule.action === "ask"))
        if (!hasScopedAllow) return true
      }

      const sessionEval = Permission.evaluate(perm, "*", input.session.permission ?? [])
      if (sessionEval.action === "deny") {
        const hasScopedAllow =
          perm === "edit" &&
          (input.session.permission ?? [])
            .filter((rule) => Wildcard.match(perm, rule.permission))
            .some((rule) => rule.pattern !== "*" && (rule.action === "allow" || rule.action === "ask"))
        if (!hasScopedAllow) return true
      }
    }
    return false
  }

  const rejected = (toolID: string, callID: string) =>
    Effect.gen(function* () {
      const mode = input.agent.name
      const userDisabled = input.userDisabled?.has(canonicalName(toolID)) ?? false
      const hint =
        mode === "reasoning_mode" || mode === "reasoning"
          ? ` In reasoning_mode only getmode, permanent memory (file .opencode/data/memory/reasoning.md), and reasoningexit are authorized. Do not call dbread, messagesearch, session-read, or other inspection tools.`
          : ""
      const output = userDisabled
        ? {
            title: "Tool disabled",
            metadata: { mode, tool: toolID, denied: true, userDisabled: true },
            output: `Tool disabled by user configuration: "${toolID}" is disabled via user.tools["${toolID}"] = false. The catalog stays on the wire — execution is refused.`,
          }
        : {
            title: "Tool denied",
            metadata: { mode, tool: toolID, denied: true },
            output: `Permission denied: tool "${toolID}" is not authorized for identity ${mode}.${hint}`,
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
            output: val.output ?? (match.state.status === "running" ? (match.state as any).output : undefined),
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
          // Agent (mode) ACL last so session-wide allows cannot reopen denied tools.
          ruleset: Permission.merge(input.session.permission ?? [], input.agent.permission),
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

  // Provider-visible tool set follows real identity (build_mode, coder_agent, …).
  // Do not force build_mode for other agents — schemas must match identity rights.
  for (const item of yield* registry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.providerAgent ?? input.agent,
    sessionID: input.session.id,
  })) {
    const name = canonicalName(item.id)
    const schema = ProviderTransform.schema(input.model, EffectZod.toJsonSchema(item.parameters))
    register(name, tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            if (denied(item.policy)) {
              return yield* rejected(item.id, options.toolCallId)
            }
            // Sidecar summary guard: constitution flag blocks execution of ALL
            // tools. Schemas stay on the wire — removing them would change the
            // request prefix and break the provider cache.
            if (Constitution.isSummaryMode(input.session.id)) {
              const output = {
                title: "Summary mode",
                metadata: {
                  summary: true,
                  denied: true,
                  tool: item.id,
                },
                output: "Tool execution disabled during summary — reply in text only.",
              }
              log.debug("tool blocked by summary mode", { tool: item.id, sessionID: input.session.id })
              yield* input.processor.completeToolCall(options.toolCallId, output)
              return output
            }
            // InfoMark grounding: MODIFY denied when active premises ∉ G
            const grounding = Constitution.guardMutationGrounding({
              sessionID: input.session.id,
              tool: item.id,
            })
            if (grounding.blocked) {
              const output = {
                title: "Grounding gate",
                metadata: {
                  grounding: true,
                  denied: true,
                  tool: item.id,
                  ungrounded: Constitution.premisesGrounded(input.session.id).ungrounded,
                },
                output: grounding.message ?? "Premises not in grounding set G (Exact|Inferred).",
              }
              log.warn("tool blocked by grounding gate", { tool: item.id, sessionID: input.session.id })
              yield* input.processor.completeToolCall(options.toolCallId, output)
              return output
            }
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

  // MCP stays in the stable provider tool surface; mode ACL refuses at execute.
  // Era-freeze: the WIRE catalog (names, descriptions, schemas) is snapshotted
  // per session+model. Live connects/disconnects or server-side tool-list
  // changes do NOT reshape the wire until invalidateMCPEra (compact / system
  // version bump). Execute closures are rebuilt per resolve from the live
  // client when present — only the wire bytes are frozen.
  const liveMcpTools = yield* mcp.tools()
  const mcpEraKey = `${input.session.id}\0${input.model.api.id}`
  const liveSig = mcpLiveSig(liveMcpTools)
  const snapshot = mcpEraGet(mcpEraKey)
  let wire: McpWire[]
  if (snapshot) {
    if (snapshot.sig !== liveSig) {
      log.info("MCP tool catalog changed — deferred to next era", {
        sessionID: input.session.id,
        snapshotTools: snapshot.wire.length,
        liveTools: Object.keys(liveMcpTools).length,
      })
    }
    wire = snapshot.wire
  } else {
    wire = []
    for (const [key, item] of Object.entries(liveMcpTools)) {
      const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
      wire.push({
        key,
        name: canonicalName(key),
        description: item.description,
        schema: ProviderTransform.schema(input.model, schema),
      })
    }
    mcpEraSet(mcpEraKey, { sig: liveSig, wire })
  }

  for (const entry of wire) {
    const key = entry.key
    const name = entry.name
    const live = liveMcpTools[key]
    const execute = live?.execute
    if (!execute) {
      // Disconnected mid-era: schema stays on the wire (prefix parity);
      // execution refuses loudly until the next era.
      register(
        name,
        tool({
          description: entry.description,
          inputSchema: jsonSchema(entry.schema),
          execute: () =>
            run.promise(
              Effect.sync(() => ({
                title: "MCP tool unavailable",
                metadata: { denied: true, tool: key, deferredEra: true },
                output: `MCP tool "${key}" is unavailable until the next session era.`,
              })),
            ),
        }),
        key,
      )
      continue
    }
    const item = tool({
      description: entry.description,
      inputSchema: jsonSchema(entry.schema),
      execute: (args, opts) =>
        run.promise(
          Effect.gen(function* () {
            if (denied(key) || denied(name)) return yield* rejected(key, opts.toolCallId)
            const ctx = context(args as Record<string, unknown>, opts)
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
        ),
    })
    register(name, item, key)
  }

  // Register short-name aliases so LLMs can use e.g. "todo" for "todowrite"
  for (const [alias, canonical] of Object.entries(TOOL_ALIASES)) {
    const tool = tools[canonical]
    if (tool && !tools[alias]) register(alias, tool, names.get(canonical) ?? canonical)
  }

  policyNames.set(tools, names)
  return tools
})

export * as SessionTools from "./tools"
