import { Provider } from "@/provider/provider"
import * as Log from "@opencode-ai/core/util/log"
import { Context, Effect, Layer, Record } from "effect"
import * as Stream from "effect/Stream"
import { streamText, wrapLanguageModel, type ModelMessage, type Tool, tool, jsonSchema } from "ai"
import { mergeDeep, pipe } from "remeda"
import { GitLabWorkflowLanguageModel } from "gitlab-ai-provider"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt, UNIVERSAL_ENV } from "./system"
import { assembleSystemMessages, collapseSystemMessages } from "./system-compose"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { Bus } from "@/bus"
import { Wildcard } from "@/util/wildcard"
import { SessionID } from "@/session/schema"
import { Auth } from "@/auth"
import { Installation } from "@/installation"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { EffectBridge } from "@/effect/bridge"
import * as Option from "effect/Option"
import { diagnoseParseError } from "@/util/diagnose-parse-error"
import { repairJsonWasm } from "@/util/json-repair-wasm"
import { repairJson as repairJsonAny, repairAny } from "@/util/anyrepair-wasm"

const log = Log.create({ service: "llm" })
let loggedSystemPrompt = false

// ── Tool Schema Serialization ────────────────────────────────────────────────

/** Extract raw JSON schema from an AI SDK Tool, handling the jsonSchema wrapper. */
function getToolSchema(t: Tool): Record<string, any> {
  try {
    const params = (t as any).parameters ?? (t as any).inputSchema
    if (!params) return {}
    if (typeof params.jsonSchema === "function") return params.jsonSchema()
    if (typeof params.jsonSchema === "object") return params.jsonSchema
    return params
  } catch { return {} }
}

/** Serialize all tool schemas into a text block for the system prompt.
 *  Sorted alphabetically by name — every invocation produces the same bytes. */
function serializeToolSchemas(tools: Record<string, Tool>): string {
  const names = Object.keys(tools).sort()
  if (names.length === 0) return ""
  const lines: string[] = ["", "## Available Tools", ""]
  for (const name of names) {
    lines.push(`### ${name}`)
    const desc = tools[name].description
    if (desc) lines.push(typeof desc === "string" ? desc : desc({ context: undefined }))
    const schema = getToolSchema(tools[name])
    if (schema && typeof schema === "object" && Object.keys(schema).length > 0) {
      lines.push("```json")
      lines.push(JSON.stringify(schema, null, 2))
      lines.push("```")
    }
    lines.push("")
  }
  return lines.join("\n")
}

// Cache for token estimation — avoids re-serializing messages+system when count is unchanged
let _cachedTokenEstimate: { count: number; value: number } | undefined

/** Per session/agent/model hash of final system messages, used to detect cache-poisoning content changes.
  * LRU-evicted at 500 entries to prevent unbounded growth. */
const systemContentHashes = new Map<string, number>()
const systemContentPrev = new Map<string, string>()
const MAX_HASHES = 500

function stableStringify(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(stableStringify).join(",")}]`
  if (input && typeof input === "object") {
    return `{${Object.entries(input as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${JSON.stringify(key)}:${stableStringify(value)}`)
      .join(",")}}`
  }
  if (typeof input === "function") return '"[function]"'
  if (typeof input === "undefined") return '"[undefined]"'
  return JSON.stringify(input)
}

function hashInfo(input: unknown) {
  const text = stableStringify(input)
  return {
    hash: Number(Bun.hash(text)),
    length: text.length,
  }
}

function checkSystemStability(input: { sessionID: string; agent: string; modelID: string; cacheKey: string; content: string }) {
  const key = input.cacheKey
  const hash = Number(Bun.hash(input.content))
  const prevHash = systemContentHashes.get(key)
  const prevContent = systemContentPrev.get(key)
  if (prevHash !== undefined && prevHash !== hash) {
    const oldLines = (prevContent ?? "").split("\n")
    const newLines = input.content.split("\n")
    let diffLine = 0
    let oldSample = ""
    let newSample = ""
    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      if (oldLines[i] !== newLines[i]) {
        diffLine = i + 1
        oldSample = (oldLines[i] ?? "(missing)").slice(0, 200)
        newSample = (newLines[i] ?? "(missing)").slice(0, 200)
        break
      }
    }
    log.warn("bug: system prompt content changed mid-session", {
      sessionID: input.sessionID,
      agent: input.agent,
      modelID: input.modelID,
      cacheKeyHash: Number(Bun.hash(input.cacheKey)),
      prevHash,
      newHash: hash,
      diffLine,
      oldLine: oldSample,
      newLine: newSample,
      oldLen: (prevContent ?? "").length,
      newLen: input.content.length,
    })
  }
  // Proper LRU: delete-then-set moves the key to the end of insertion order
  // so that FIFO-ordered keys().next() evicts the least-recently-used entry.
  if (systemContentHashes.has(key)) {
    systemContentHashes.delete(key)
    systemContentPrev.delete(key)
  }
  systemContentHashes.set(key, hash)
  systemContentPrev.set(key, input.content)
  if (systemContentHashes.size > MAX_HASHES) {
    const first = systemContentHashes.keys().next().value
    if (first !== undefined) {
      systemContentHashes.delete(first)
      systemContentPrev.delete(first)
    }
  }
}

export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX
type Result = Awaited<ReturnType<typeof streamText>>

export type StreamInput = {
  user: MessageV2.User
  sessionID: string
  parentSessionID?: string
  providerCacheKey?: string
  model: Provider.Model
  agent: Agent.Info
  permission?: Permission.Ruleset
  system: string[]
  messages: ModelMessage[]
  small?: boolean
  tools: Record<string, Tool>
  retries?: number
  outputTokenMax?: number
  toolChoice?: "auto" | "required" | "none"
  checkpoint?: boolean
}

export type StreamRequest = StreamInput & {
  abort: AbortSignal
}

export type Event = Result["stream"] extends AsyncIterable<infer T> ? T : never

export interface Interface {
  readonly stream: (input: StreamInput) => Stream.Stream<Event, unknown>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/LLM") {}

const live: Layer.Layer<
  Service,
  never,
  Auth.Service | Config.Service | Provider.Service | Plugin.Service | Permission.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const plugin = yield* Plugin.Service
    const perm = yield* Permission.Service

    const run = Effect.fn("LLM.run")(function* (input: StreamRequest) {
      const l = log
        .clone()
        .tag("providerID", input.model.providerID)
        .tag("modelID", input.model.id)
        .tag("session.id", input.sessionID)
        .tag("small", (input.small ?? false).toString())
        .tag("agent", input.agent.name)
        .tag("mode", input.agent.mode)
      l.info("stream", {
        modelID: input.model.id,
        providerID: input.model.providerID,
      })

      const [language, cfg, item, info] = yield* Effect.all(
        [
          provider.getLanguage(input.model),
          config.get(),
          provider.getProvider(input.model.providerID),
          auth.get(input.model.providerID),
        ],
        { concurrency: "unbounded" },
      )

      // TODO: move this to a proper hook
      const isOpenaiOauth = item.id === "openai" && info?.type === "oauth"

      // Separate parts — do NOT split(joined, "\n\n"): files use blank lines,
      // so that left only the reasoning title and buried PROMPT_ABI inside "kernel".
      const {
        reasoning: reasoningPrefix,
        algorithm: algorithmCard,
        kernel,
      } = ProviderTransform.systemPromptParts(input.model)
      const promptFile = input.agent.prompt ? `agent:${input.agent.name}` : "reasoning-only"

      l.info("system prompt", {
        reasoning: !!reasoningPrefix,
        reasoningBytes: Buffer.byteLength(reasoningPrefix, "utf8"),
        algorithm: !!algorithmCard,
        algorithmBytes: Buffer.byteLength(algorithmCard, "utf8"),
        kernel: !!kernel,
        kernelBytes: Buffer.byteLength(kernel, "utf8"),
        kernelHasAbi: kernel.includes("PROMPT_ABI"),
        prompt: promptFile,
        agent: input.agent.name,
        model: input.model.id,
      })

      // Tool schemas — sorted text block for the cached prefix (slot 1).
      // The AI SDK `tools` parameter is still passed separately for tool calling.
      const toolSchemaText = serializeToolSchemas(input.tools)
      const isCheckpoint = input.checkpoint === true

      // Active/inactive tools line — short, changes per agent; lands in collapsed tail.
      const activeToolSet = resolveTools(input)
      const activeNames = Object.keys(activeToolSet).sort()
      const allNames = Object.keys(input.tools).sort()
      const inactiveNames = allNames.filter((n) => !activeNames.includes(n))
      const toolsLine = inactiveNames.length > 0
        ? `Active tools: ${activeNames.join(", ")}\nInactive: ${inactiveNames.join(", ")}`
        : `Active tools: ${activeNames.join(", ")}`

      const banner = `[session: ${input.providerCacheKey ?? input.sessionID}]`

      const system: string[] = assembleSystemMessages({
        universalEnv: UNIVERSAL_ENV,
        toolSchemas: toolSchemaText,
        reasoningPrefix,
        algorithmCard,
        kernel,
        agentPrompt: input.agent.prompt ?? "",
        pathSystem: input.system,
        activeToolsLine: toolsLine,
        banner,
        userSystem: input.user.system,
        checkpoint: isCheckpoint,
      })

      if (!loggedSystemPrompt) {
        loggedSystemPrompt = true
        l.info("system prompt dump (once)", { content: system.join("\n") })
      }
      const header = system[0]!
      yield* plugin.trigger(
        "experimental.chat.system.transform",
        { sessionID: input.sessionID, model: input.model },
        { system },
      )
      // Collapse: keep stable prefix (UE, tools, identity+path) separate from
      // the mutable session/tools tail. Do NOT join session banner into path —
      // that forced full path/skills recompute on every new session (~20–40k miss).
      const collapsed = collapseSystemMessages(system, header)
      system.length = 0
      system.push(...collapsed)

      // Detect cache-poisoning: if one agent/model's system prompt content changes
      // while its provider cache key is stable, the provider cache is invalidated.
      const providerCacheKey = input.providerCacheKey
        ? [input.providerCacheKey, input.agent.name].join(":")
        : [input.sessionID, input.agent.name, input.model.id].join(":")
      checkSystemStability({
        sessionID: input.sessionID,
        agent: input.agent.name,
        modelID: input.model.id,
        cacheKey: providerCacheKey,
        content: system.join(""),
      })

      const variant =
        !input.small && input.model.variants && input.user.model.variant
          ? input.model.variants[input.user.model.variant]
          : {}
      const base = input.small
        ? ProviderTransform.smallOptions(input.model)
        : ProviderTransform.options({
            model: input.model,
            sessionID: input.sessionID,
            cacheKey: providerCacheKey,
            providerOptions: item.options,
          })
      const options: Record<string, any> = pipe(
        base,
        mergeDeep(input.model.options),
        mergeDeep(input.agent.options),
        mergeDeep(variant),
      )

      if (isOpenaiOauth) {
        options.instructions = system.join("\n")
      }

      const isWorkflow = language instanceof GitLabWorkflowLanguageModel
      const messages = isOpenaiOauth || isWorkflow
        ? input.messages
        : input.messages

      // Cached token estimate — avoid full JSON.stringify of huge histories.
      // chars/4 over string content is good enough for maxOutputTokens budgeting.
      let contentTokens: number
      const msgCount = messages.length
      if (_cachedTokenEstimate && _cachedTokenEstimate.count === msgCount) {
        contentTokens = _cachedTokenEstimate.value
      } else {
        let chars = 0
        for (const s of system) chars += s.length
        for (const m of messages) {
          const c = (m as { content?: unknown }).content
          if (typeof c === "string") chars += c.length
          else if (Array.isArray(c)) {
            for (const part of c) {
              if (part && typeof part === "object" && "text" in part && typeof (part as { text: unknown }).text === "string") {
                chars += (part as { text: string }).text.length
              } else if (part && typeof part === "object" && "type" in part) {
                chars += 64 // tool-call / image / etc. — rough fixed cost
              }
            }
          } else {
            chars += 32
          }
        }
        contentTokens = Math.ceil(chars / 4)
        _cachedTokenEstimate = { count: msgCount, value: contentTokens }
      }

      const params = yield* plugin.trigger(
        "chat.params",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
          message: input.user,
        },
        {
          temperature: input.model.capabilities.temperature
            ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
            : undefined,
          topP: input.agent.topP ?? ProviderTransform.topP(input.model),
          topK: ProviderTransform.topK(input.model),
          maxOutputTokens: ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax, contentTokens),
          options,
        },
      )

      // For reasoning models, max_tokens includes both reasoning and output tokens.
      // Reasoning can consume 50-80% of the budget, so we need to account for that.
      const rawMaxOutput = ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax, contentTokens)
      let maxOut: number | undefined
      if (input.outputTokenMax !== undefined) {
        maxOut = input.outputTokenMax
      } else if (input.model.capabilities.reasoning) {
        maxOut = Math.min(rawMaxOutput * 3, input.model.limit.output || rawMaxOutput * 3)
      } else {
        maxOut = rawMaxOutput
      }

      // OpenAI Responses API reasoning models (gpt-5.x, o-series) reject
      // max_output_tokens with "Unsupported parameter: max_output_tokens".
      // The @ai-sdk/openai Responses model sends max_output_tokens for all
      // models, but the API rejects it for reasoning models. Drop the cap so
      // the API falls back to the model's default output budget.
      // See: https://github.com/anomalyco/opencode/issues/5421
      if (input.model.providerID === "openai" && input.model.capabilities.reasoning) {
        maxOut = undefined
      }
      log.info("output token budget", {
        model: input.model.id,
        provider: input.model.providerID,
        limitOutput: input.model.limit.output,
        contentTokens,
        rawMaxOutput: rawMaxOutput,
        maxOutputTokens: maxOut,
        reasoning: input.model.capabilities.reasoning,
      })

      const { headers } = yield* plugin.trigger(
        "chat.headers",
        {
          sessionID: input.sessionID,
          agent: input.agent.name,
          model: input.model,
          provider: item,
          message: input.user,
        },
        {
          headers: {},
        },
      )

      const tools = resolveTools(input)

      // LiteLLM and some Anthropic proxies require the tools parameter to be present
      // when message history contains tool calls, even if no tools are being used.
      // Add a dummy tool that is never called to satisfy this validation.
      // This is enabled for:
      // 1. Providers with "litellm" in their ID or API ID (auto-detected)
      // 2. Providers with explicit "litellmProxy: true" option (opt-in for custom gateways)
      const isLiteLLMProxy =
        item.options?.["litellmProxy"] === true ||
        input.model.providerID.toLowerCase().includes("litellm") ||
        input.model.api.id.toLowerCase().includes("litellm")

      // LiteLLM/Bedrock rejects requests where the message history contains tool
      // calls but no tools param is present. When there are no active tools (e.g.
      // during compaction), inject a stub tool to satisfy the validation requirement.
      // The stub description explicitly tells the model not to call it.
      if (
        (isLiteLLMProxy || input.model.providerID.includes("github-copilot")) &&
        Object.keys(tools).length === 0 &&
        hasToolCalls(input.messages)
      ) {
        tools["_noop"] = tool({
          description: "Do not call this tool. It exists only for API compatibility and must never be invoked.",
          inputSchema: jsonSchema({
            type: "object",
            properties: {
              reason: { type: "string", description: "Unused" },
            },
          }),
          execute: async () => ({ output: "", title: "", metadata: {} }),
        })
      }

      // Wire up toolExecutor for DWS workflow models so that tool calls
      // from the workflow service are executed via opencode's tool system
      // and results sent back over the WebSocket.
      if (language instanceof GitLabWorkflowLanguageModel) {
        const workflowModel = language as GitLabWorkflowLanguageModel & {
          sessionID?: string
          sessionPreapprovedTools?: string[]
          approvalHandler?: (approvalTools: { name: string; args: string }[]) => Promise<{ approved: boolean }>
        }
        workflowModel.sessionID = input.sessionID
        workflowModel.systemPrompt = system.join("\n")
        workflowModel.toolExecutor = async (toolName, argsJson, _requestID) => {
          const t = tools[toolName]
          if (!t || !t.execute) {
            return { result: "", error: `Unknown tool: ${toolName}` }
          }
          try {
            const result = await t.execute!(JSON.parse(argsJson), {
              toolCallId: _requestID,
              messages: input.messages,
              abortSignal: input.abort,
              context: {},
            })
            const output = typeof result === "string" ? result : (result?.output ?? JSON.stringify(result))
            return {
              result: output,
              metadata: typeof result === "object" ? result?.metadata : undefined,
              title: typeof result === "object" ? result?.title : undefined,
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e)
            Log.Default.warn("bug: tool execution failed", { error: msg })
            return { result: "", error: msg }
          }
        }

        const ruleset = Permission.merge(input.agent.permission ?? [], input.permission ?? [])
        workflowModel.sessionPreapprovedTools = Object.keys(tools).filter((name) => {
          const match = ruleset.findLast((rule) => Wildcard.match(name, rule.permission))
          return !match || match.action !== "ask"
        })

        const bridge = yield* EffectBridge.make()
        const approvedToolsForSession = new Set<string>()
        workflowModel.approvalHandler = Instance.bind(async (approvalTools) => {
          const uniqueNames = [...new Set(approvalTools.map((t: { name: string }) => t.name))] as string[]
          // Auto-approve tools that were already approved in this session
          // (prevents infinite approval loops for server-side MCP tools)
          if (uniqueNames.every((name) => approvedToolsForSession.has(name))) {
            return { approved: true }
          }

          const id = PermissionID.ascending()
          let unsub: (() => void) | undefined
          try {
            unsub = Bus.subscribe(Permission.Event.Replied, (evt) => {
              if (evt.properties.requestID === id) void evt.properties.reply
            })
            const toolPatterns = approvalTools.map((t: { name: string; args: string }) => {
              try {
                const parsed = JSON.parse(t.args) as Record<string, unknown>
                const title = (parsed?.title ?? parsed?.name ?? "") as string
                return title ? `${t.name}: ${title}` : t.name
              } catch (e) {
                Log.Default.warn("bug: failed to parse tool approval args", { error: String(e), args: t.args })
                return t.name
              }
            })
            const uniquePatterns = [...new Set(toolPatterns)] as string[]
            await bridge.promise(
              perm.ask({
                id,
                sessionID: SessionID.make(input.sessionID),
                permission: "workflow_tool_approval",
                patterns: uniquePatterns,
                metadata: { tools: approvalTools },
                always: uniquePatterns,
                ruleset: [],
              }),
            )
            for (const name of uniqueNames) approvedToolsForSession.add(name)
            workflowModel.sessionPreapprovedTools = [...(workflowModel.sessionPreapprovedTools ?? []), ...uniqueNames]
            return { approved: true }
          } catch (e) {
            Log.Default.warn("bug: workflow tool approval failed", { error: String(e) })
            return { approved: false }
          } finally {
            unsub?.()
          }
        })
      }

      const promptCacheKey = options["promptCacheKey"] ?? options["prompt_cache_key"]
      l.info("request shape", {
        system: hashInfo(system),
        providerOptions: hashInfo(options),
        tools: hashInfo(Object.keys(tools).sort()),
        messages: hashInfo(messages),
        toolChoice: input.toolChoice ?? "auto",
        promptCacheKey: {
          present: typeof promptCacheKey === "string",
          hash: typeof promptCacheKey === "string" ? Number(Bun.hash(promptCacheKey)) : undefined,
          scope: typeof promptCacheKey === "string" ? "session:agent:model" : undefined,
        },
      })

      return streamText({
        onError(error) {
          l.error("stream error", {
            error,
          })
        },
        async experimental_repairToolCall(failed) {
          l.info("repair callback invoked", {
            tool: failed.toolCall.toolName,
            inputLen: String(failed.toolCall.input).length,
            error: failed.error.message,
          })
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && tools[lower]) {
            l.info("repairing tool call", {
              tool: failed.toolCall.toolName,
              repaired: lower,
            })
            return {
              ...failed.toolCall,
              toolName: lower,
            }
          }
          // Strip null bytes first — they break JSON.parse.
          const rawInput = String(failed.toolCall.input).replace(/\x00/g, "")

          // Tier 1: fast JSON repair via json-repair WASM (proven, lightweight)
          const repaired1 = await repairJsonWasm(rawInput)
          if (repaired1 !== null) {
            l.info("repaired malformed JSON in tool call (json-repair)", {
              tool: failed.toolCall.toolName,
            })
            return {
              ...failed.toolCall,
              input: repaired1,
            }
          }

          // Tier 2: JSON repair via anyrepair (handles more edge cases)
          const repaired2 = await repairJsonAny(rawInput)
          if (repaired2 !== null) {
            l.info("repaired malformed JSON in tool call (anyrepair-json)", {
              tool: failed.toolCall.toolName,
            })
            return {
              ...failed.toolCall,
              input: repaired2,
            }
          }

          // Tier 3: auto-detect repair via anyrepair (JSON, XML, or other format)
          const repaired3 = await repairAny(rawInput)
          if (repaired3 !== null && repaired3 !== rawInput) {
            l.info("repaired malformed tool call input (anyrepair-auto)", {
              tool: failed.toolCall.toolName,
            })
            return {
              ...failed.toolCall,
              input: repaired3,
            }
          }

          // All repair attempts failed — redirect to invalid tool
          return {
            ...failed.toolCall,
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: diagnoseParseError(failed.error.message),
            }),
            toolName: "invalid",
          }
        },
        temperature: params.temperature,
        topP: params.topP,
        topK: params.topK,
        providerOptions: ProviderTransform.providerOptions(input.model, params.options),
        activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
        tools,
        toolChoice: input.toolChoice,
        maxOutputTokens: maxOut,
        abortSignal: input.abort,
        ...(isOpenaiOauth || isWorkflow
          ? {}
          : { system: system.map((content) => ({ role: "system" as const, content })) }),
        headers: {
          ...(input.model.providerID.startsWith("opencode")
            ? {
                "x-opencode-project": Instance.project.id,
                "x-opencode-session": input.sessionID,
                "x-opencode-request": input.user.id,
                "x-opencode-client": Flag.OPENCODE_CLIENT,
                "User-Agent": `opencode/${InstallationVersion}`,
              }
            : {
                "x-session-affinity": input.sessionID,
                ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
                "User-Agent": `opencode/${InstallationVersion}`,
              }),
          ...input.model.headers,
          ...headers,
        },
        maxRetries: input.retries ?? 0,
        messages,
        model: wrapLanguageModel({
          model: language,
          middleware: [
            {
              specificationVersion: "v3" as const,
              async transformParams(args) {
                if (args.type === "stream") {
                  // @ts-expect-error
                  args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
                  // Diagnostic: check cache markers on first system message
                  const sysMsg: any = args.params.prompt.find((m: any) => m.role === "system")
                  const lastContent: any = sysMsg?.content?.[sysMsg.content?.length - 1]
                  const hasCacheControl: any = sysMsg?.providerOptions?.openaiCompatible?.cache_control
                    ?? lastContent?.providerOptions?.openaiCompatible?.cache_control
                  log.info("cache marker check", {
                    providerID: input.model.providerID,
                    modelID: input.model.id,
                    hasCacheControl: !!hasCacheControl,
                    cacheControlValue: hasCacheControl ?? null,
                    systemMsgCount: args.params.prompt.filter((m: any) => m.role === "system").length,
                  })
                }
                return args.params
              },
            },
          ],
        }),
      })
    })

    const stream: Interface["stream"] = (input) =>
      Stream.scoped(
        Stream.unwrap(
          Effect.gen(function* () {
            const ctrl = yield* Effect.acquireRelease(
              Effect.sync(() => new AbortController()),
              (ctrl) => Effect.sync(() => ctrl.abort()),
            )

            const result = yield* run({ ...input, abort: ctrl.signal })

            return Stream.fromAsyncIterable(result.stream, (e) => (e instanceof Error ? e : new Error(String(e))))
          }),
        ),
      )

    return Service.of({ stream })
  }),
)

export const layer = live.pipe(Layer.provide(Permission.defaultLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
  ),
)

function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  const disabled = Permission.disabled(
    Object.keys(input.tools),
    Permission.merge(input.agent.permission, input.permission ?? []),
  )
  return Record.filter(input.tools, (_, k) => input.user.tools?.[k] !== false && !disabled.has(k))
}

// Check if messages contain any tool-call content
// Used to determine if a dummy tool should be added for LiteLLM proxy compatibility
export function hasToolCalls(messages: ModelMessage[]): boolean {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue
    for (const part of msg.content) {
      if (part.type === "tool-call" || part.type === "tool-result") return true
    }
  }
  return false
}

export * as LLM from "./llm"
