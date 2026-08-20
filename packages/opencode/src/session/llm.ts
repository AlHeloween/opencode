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
import { MessageV2 } from "./message-v2"
import { Plugin } from "@/plugin"
import { SystemPrompt, UNIVERSAL_ENV } from "./system"
import { assembleSystemMessages, collapseSystemMessagesInPlace } from "./system-compose"
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
import { canonicalName, TOOL_ALIASES } from "@/tool/tool"
import { repairJsonWasm } from "@/util/json-repair-wasm"
import { readWasmAsset } from "@/util/wasm-path"
import { REQUEST_OVERHEAD_TOKENS, usable } from "./overflow"
import { isPrimaryModeIdentity } from "./mode-identity"

const log = Log.create({ service: "llm" })
const loggedSystemPromptForCacheKey = new Map<string, boolean>()

// ── Tree-sitter JSON parser (lazy) ───────────────────────────────────────────

let _jsonParserPromise: Promise<import("web-tree-sitter").Parser> | undefined

async function getJsonParser(): Promise<import("web-tree-sitter").Parser> {
  if (_jsonParserPromise) return _jsonParserPromise
  _jsonParserPromise = (async () => {
    const [{ Parser }, { Language }, jsonWasm, runtimeWasm] = await Promise.all([
      import("web-tree-sitter"),
      import("web-tree-sitter"),
      readWasmAsset("grammars/tree-sitter-json.wasm"),
      readWasmAsset("web-tree-sitter.wasm"),
    ])
    if (!jsonWasm.bytes) throw new Error("tree-sitter-json grammar unavailable")
    if (!runtimeWasm.bytes) throw new Error("tree-sitter runtime unavailable")
    await (Parser.init as any)({ wasmBinary: runtimeWasm.bytes })
    const language = await Language.load(new Uint8Array(jsonWasm.bytes))
    const parser = new Parser()
    parser.setLanguage(language)
    return parser
  })()
  return _jsonParserPromise
}

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

/**
 * Per session/agent/model hash of the WIRE tool catalog (insertion order).
 * Detects mid-session catalog drift that changes the provider request prefix:
 * reconnects, plugin rewrites, catalog growth. Mirrors checkSystemStability.
 */
const toolCatalogHashes = new Map<string, number>()
const toolCatalogPrev = new Map<string, string>()
const MAX_TOOL_HASHES = 500

function checkToolStability(input: {
  sessionID: string
  agent: string
  modelID: string
  cacheKey: string
  tools: Record<string, Tool>
}) {
  const wire = Object.keys(input.tools).map((name) => {
    const item = input.tools[name]
    const desc = typeof item.description === "string" ? item.description : item.description?.({ context: undefined } as never) ?? ""
    return [name, desc, getToolSchema(item)]
  })
  const content = stableStringify(wire)
  const hash = Number(Bun.hash(content))
  const prevHash = toolCatalogHashes.get(input.cacheKey)
  const prevContent = toolCatalogPrev.get(input.cacheKey)
  if (prevHash !== undefined && prevHash !== hash) {
    log.warn("bug: tool catalog changed mid-session", {
      sessionID: input.sessionID,
      agent: input.agent,
      modelID: input.modelID,
      cacheKeyHash: Number(Bun.hash(input.cacheKey)),
      prevHash,
      newHash: hash,
      prevToolCount: prevContent ? prevContent.split("\u0000").length : undefined,
      newToolCount: Object.keys(input.tools).length,
    })
  }
  if (toolCatalogHashes.has(input.cacheKey)) {
    toolCatalogHashes.delete(input.cacheKey)
    toolCatalogPrev.delete(input.cacheKey)
  }
  toolCatalogHashes.set(input.cacheKey, hash)
  toolCatalogPrev.set(input.cacheKey, content)
  if (toolCatalogHashes.size > MAX_TOOL_HASHES) {
    const first = toolCatalogHashes.keys().next().value
    if (first !== undefined) {
      toolCatalogHashes.delete(first)
      toolCatalogPrev.delete(first)
    }
  }
}

function checkSystemStability(input: { sessionID: string; agent: string; modelID: string; cacheKey: string; content: string }) {  const key = input.cacheKey
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

/**
 * Stable provider prompt-cache key.
 *
 * Primary modes (build/plan/reasoning) share one cache entry because they have
 * the same system prefix — kernel + rules + skills + env + instructions (slots
 * [0..N] in system-compose.ts). Only the mutable tail (agentPrompt) differs and
 * provider prefix caching handles that.
 *
 * Non-primary agents (title_agent, sub-agents) get their own namespace because
 * their system prompts are significantly different (no kernel, stripped rules).
 * Sub-agents also bypass this entirely via cacheLease?.cacheKey in task.ts.
 *
 * `providerCacheKey` override (from cacheLease) bypasses this entirely.
 */
export function buildProviderCacheKey(input: {
  sessionID: string
  providerCacheKey?: string
  modelID: string
  identity?: string
}) {
  if (input.providerCacheKey) return input.providerCacheKey
  const identity = input.identity ?? "build_mode"
  // Primary modes share the same system prefix — one cache entry for all modes.
  if (isPrimaryModeIdentity(identity)) {
    return [input.sessionID, input.modelID].join(":")
  }
  // Non-primary agents (title, sub-agents) get their own namespace.
  return [input.sessionID, input.modelID, identity].join(":")
}

/** Resolve a tool-call alias (separators/case + short-name aliases) to the provider-canonical name when present. */
export function resolveToolName(name: string, tools: Record<string, Tool>) {
  const canonical = canonicalName(name)
  if (canonical && tools[canonical]) return canonical
  // Check explicit short-name aliases (e.g. "todo" → "todowrite")
  const aliased = TOOL_ALIASES[canonical]
  if (aliased && tools[aliased]) return aliased
  return undefined
}

/**
 * Approximate full request for dynamic output budgeting: symbols/4 + 10k overhead.
 * Recompute every request — equal message counts ≠ equal content.
 */
export function estimateContentTokens(system: string[], messages: ModelMessage[]): number {
  let chars = system.reduce((total, content) => total + content.length, 0)
  for (const message of messages) {
    const content = message.content
    if (typeof content === "string") {
      chars += content.length
      continue
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          chars += part.text.length
          continue
        }
        if (part && typeof part === "object" && "type" in part) chars += 64
      }
      continue
    }
    chars += 32
  }
  if (chars <= 0) return 0
  return Math.ceil(chars / 4) + REQUEST_OVERHEAD_TOKENS
}

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

      const parts = ProviderTransform.systemPromptParts(input.model)
      const reasoningPrefix = parts.reasoning
      const kernel = parts.kernel
      const promptFile = input.agent.prompt ? `agent:${input.agent.name}` : "reasoning-only"

      l.info("system prompt", {
        reasoning: !!reasoningPrefix,
        kernel: !!kernel,
        prompt: promptFile,
        agent: input.agent.name,
        model: input.model.id,
      })

      // Tool definitions are delivered via AI SDK `tools` JSON parameter
      // (function-calling schemas) — no prose duplicate in system messages.
      const isCheckpoint = input.checkpoint === true

      const isOpenCodeProvider = input.model.providerID.startsWith("opencode")
      // Mode and role are recorded as synthetic user-message transitions in
      // SessionPrompt. They must never enter the system prefix: the same model
      // session shares this prefix across identities for provider KV reuse.
      const banner = isOpenCodeProvider ? `[session: ${input.providerCacheKey ?? input.sessionID}]` : ""

      const system: string[] = assembleSystemMessages({
        universalEnv: UNIVERSAL_ENV,
        reasoningPrefix,
        kernel,
        agentPrompt: "",
        pathSystem: input.system,
        activeToolsLine: "",
        banner,
        userSystem: input.user.system,
        checkpoint: isCheckpoint,
      })

      const header = system[0]!
      yield* plugin.trigger(
        "experimental.chat.system.transform",
        { sessionID: input.sessionID, model: input.model },
        { system },
      )
      // Collapse: keep stable prefix (UE, tools, identity+path) separate from
      // the mutable session/tools tail. Do NOT join session banner into path —
      // that forced full path/skills recompute on every new session (~20–40k miss).
      collapseSystemMessagesInPlace(system, header)

      // Detect cache-poisoning: if one agent/model's system prompt content changes
      // while its provider cache key is stable, the provider cache is invalidated.
      // Primary modes share one cache entry (same system prefix). Non-primary agents
      // get their own namespace (different system prompt).
      const providerCacheKey = buildProviderCacheKey({
        sessionID: input.sessionID,
        providerCacheKey: input.providerCacheKey,
        modelID: input.model.id,
        identity: input.agent.name,
      })
      if (!loggedSystemPromptForCacheKey.has(providerCacheKey)) {
        loggedSystemPromptForCacheKey.set(providerCacheKey, true)
        l.info("system prompt ready (once)", { content: system.join("\n") })
      }
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

      const contentTokens = estimateContentTokens(system, messages)

      // Pre-send context overflow guard: block request BEFORE it reaches the provider.
      // This is the last line of defense — Layer-1/Layer-2 compaction may have been
      // bypassed due to timing, or the heuristic may have underestimated content size.
      if (input.model.limit.context > 0) {
        const cfg = yield* config.get()
        const usableLimit = usable({ cfg, model: input.model })
        // contentTokens = chars/4 + REQUEST_OVERHEAD_TOKENS (already includes 10k overhead)
        // usableLimit = limit - (REQUEST_OVERHEAD_TOKENS + outputReserve) (already subtracts 10k)
        // Subtract REQUEST_OVERHEAD_TOKENS from contentTokens to avoid double-counting the 10k overhead.
        if (usableLimit > 0 && contentTokens - REQUEST_OVERHEAD_TOKENS >= usableLimit) {
          l.warn("pre-send overflow guard triggered", {
            contentTokens,
            usableLimit,
            contextLimit: input.model.limit.context,
            systemLen: system.join("").length,
            messageCount: messages.length,
          })
          // Throw a real ContextOverflowError so processor.halt() → parse()
          // recognises it as a context_overflow error and triggers compaction
          // instead of surfacing it as a generic error.
          throw new MessageV2.ContextOverflowError(
            {
              message: `Pre-send guard: estimated ${contentTokens} tokens exceeds usable context limit of ${usableLimit} tokens (model context: ${input.model.limit.context})`,
            },
          )
        }
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
        // Insertion order — the wire order. Sorted hashes would mask
        // wire-order drift (audit says stable, gateway sees different bytes).
        tools: hashInfo(Object.keys(tools)),
        messages: hashInfo(messages),
        toolChoice: input.toolChoice ?? "auto",
        promptCacheKey: {
          present: typeof promptCacheKey === "string",
          hash: typeof promptCacheKey === "string" ? Number(Bun.hash(promptCacheKey)) : undefined,
          scope: typeof promptCacheKey === "string" ? "session:agent:model" : undefined,
        },
      })

      // Wire catalog drift detector — includes the post-resolve _noop stub.
      checkToolStability({
        sessionID: input.sessionID,
        agent: input.agent.name,
        modelID: input.model.id,
        cacheKey: providerCacheKey,
        tools,
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
          // Case-insensitive tool name fix (e.g. "Bash" → "bash")
          const lower = failed.toolCall.toolName.toLowerCase()
          if (lower !== failed.toolCall.toolName && tools[lower]) {
            l.info("repairing tool call", { tool: failed.toolCall.toolName, repaired: lower })
            return { ...failed.toolCall, toolName: lower }
          }
          // Strip null bytes — they break JSON.parse.
          const rawInput = String(failed.toolCall.input).replace(/\x00/g, "")

          // Step 1: try JSON.parse — the authoritative validity check.
          try {
            JSON.parse(rawInput)
            return { ...failed.toolCall, input: rawInput }
          } catch (originalError) {
            const originalMessage = (originalError as Error).message

            // Step 2: lightweight JSON repair (json-repair WASM, not anyrepair).
            // If repair fixes it — use silently, model doesn't need to know.
            const repaired = await repairJsonWasm(rawInput)
            if (repaired !== null) {
              try {
                JSON.parse(repaired)
                l.info("repaired malformed JSON in tool call (json-repair)", {
                  tool: failed.toolCall.toolName,
                })
                return { ...failed.toolCall, input: repaired }
              } catch {
                // repaired JSON still invalid — fall through to error
              }
            }

            // Step 3: repair failed. Tell model the ORIGINAL error + position
            // so it can correct and retry the tool call.
            // Throw (don't return "invalid") — the AI SDK surfaces this
            // error to the model, which then regenerates the tool call.
            // tree-sitter JSON is a system dependency — always available.
            const jsonParser = await getJsonParser()
            const tree = jsonParser.parse(rawInput)
            let message = `Invalid JSON: ${originalMessage}`
            if (tree) {
              const errors = tree.rootNode.descendantsOfType("ERROR")
              if (errors.length > 0) {
                const first = errors[0]!
                const lines = rawInput.slice(0, first.startIndex).split("\n")
                message = `JSON error at line ${lines.length}, column ${(lines[lines.length - 1]?.length ?? 0) + 1}: ${originalMessage}`
              }
            }
            l.info("tool call JSON parse error — throwing for model retry", {
              tool: failed.toolCall.toolName,
              error: message,
            })
            throw new Error(message)
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
                "x-session-affinity": input.sessionID,
                "x-opencode-project": Instance.project.id,
                "x-opencode-session": input.sessionID,
                "x-opencode-request": input.user.id,
                "x-opencode-client": Flag.OPENCODE_CLIENT,
                "User-Agent": `opencode/${InstallationVersion}`,
              }
            : {
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

/**
 * Provider-facing tool set — keep schemas unified for all agents/modes.
 * Wire filtering is FORBIDDEN here: a changed tool set breaks inference and
 * the KV prefix. `user.tools[k] === false` opt-outs are enforced at execute
 * time by SessionTools.denied (runtime-deny), not by reshaping the catalog.
 */
export function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "permission" | "user">) {
  return input.tools
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
