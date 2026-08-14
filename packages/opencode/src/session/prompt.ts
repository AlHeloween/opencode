import path from "path"
import os from "os"
import z from "zod"
import * as EffectZod from "@/util/effect-zod"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type Tool as AITool, type ModelMessage, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import {
  estimateContentTokens,
  estimateRequestTokens,
  needsContentCompaction,
  summaryWindowLimit,
  usable,
} from "./overflow"
import { Jobs } from "../jobs"
import { RequestDiff } from "./request-diff"
import { Checkpoint, type CheckpointData } from "./checkpoint"
import { IncrementalCheckpoint } from "./incremental-checkpoint"
import { Bus } from "../bus"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "./system"
import { assemblePathSystem } from "./system-compose"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN_RAW from "../session/prompt/plan.txt"
import PROMPT_BUILD_RAW from "../session/prompt/build.txt"
import PROMPT_REASONING_RAW from "../session/prompt/reasoning-mode.txt"
// Normalize CRLF → LF so exact text comparisons match DB-stored versions
// regardless of OS line-ending conventions. Failure to do this causes
// hasSynthetic() to miss existing synthetic parts, leading to re-push
// with new PartID → KV cache break on every turn.
const PROMPT_PLAN = PROMPT_PLAN_RAW.replace(/\r\n/g, "\n")
const PROMPT_BUILD = PROMPT_BUILD_RAW.replace(/\r\n/g, "\n")
const PROMPT_REASONING = PROMPT_REASONING_RAW.replace(/\r\n/g, "\n")
import MAX_STEPS from "../session/prompt/max-steps.txt"

/** Bounded replay of completed tool outputs keeps per-turn cache-miss blocks small.
 *  Config: tool_output.replay_max_chars (default MessageV2.REPLAY_TOOL_OUTPUT_MAX_CHARS). */
const toolReplayOptions = (cfg: { tool_output?: { replay_max_chars?: number } }) => ({
  toolOutputMaxChars: cfg.tool_output?.replay_max_chars ?? MessageV2.REPLAY_TOOL_OUTPUT_MAX_CHARS,
})
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { SessionTools } from "./tools"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { EffectBridge } from "@/effect/bridge"
import { convertDocument, isSupportedDocumentFormat } from "@/util/markdownify"

import { canonicalIdentity, isPrimaryModeIdentity } from "./mode-identity"

/**
 * Mode text is a one-shot conversation transition record. It must never be
 * re-injected while an agent remains in the same mode: steady-state mode
 * boundaries are enforced by software permissions, not fresh prompt prose.
 * Compares canonical ids (plan → plan_mode) so legacy short names still transition.
 */
export function modeInstructionForTransition(previousMode: string | undefined, nextMode: string) {
  const prev = previousMode ? canonicalIdentity(previousMode) : undefined
  const next = canonicalIdentity(nextMode)
  if (prev === next) return
  if (next === "plan_mode") return PROMPT_PLAN
  if (next === "build_mode") return PROMPT_BUILD
  if (next === "reasoning_mode") return PROMPT_REASONING
}

/** Full build_mode transition text (also attached eagerly by planexit). */
export function buildModeInstruction() {
  return PROMPT_BUILD
}

export function planModeInstruction() {
  return PROMPT_PLAN
}

export function reasoningModeInstruction() {
  return PROMPT_REASONING
}

/**
 * Provider-visible identity = real agent (build_mode, plan_mode, coder_agent, …).
 * Protocol (GATED_WORKFLOW in reasoning_prompt.txt) is shared; identity switches.
 * Role text is a synthetic user notify on switch; ACL is execute-time on the same agent.
 * Identity switch intentionally changes agent-scoped checkpoint/tool set — do not
 * force build_mode for other identities.
 */
export function providerIdentityForMode(agent: Agent.Info, _fallback: Agent.Info) {
  return agent
}

/** Subagent / specialized role as conversation notify (not system-prefix mutation). */
export function roleInstructionForAgent(agent: Agent.Info): string | undefined {
  if (!agent.prompt?.trim()) return
  if (isPrimaryModeIdentity(agent.name)) return
  return (
    `<system-reminder>\n# Role: ${agent.name}\n\n${agent.prompt.trim()}\n</system-reminder>`
  )
}

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })
const sidecarInFlight = new Set<string>()
/** Minimum interval between sidecar checkpoint captures per session (ms).
 *  Prevents excessive LLM calls when the model completes many short turns
 *  in rapid succession. 30s balances freshness vs cost. */
const SIDECAR_COOLDOWN_MS = 30_000
/** Track last successful sidecar capture time per session. */
const lastSidecarCapture = new Map<string, number>()

/** Track the last injected mode per session. Compaction can hide the previous
 *  message, but another session must never affect this transition record. */
const lastInjectedMode = new Map<SessionID, string>()

/** Reusable: filter thenmap visible agent names from a list. */
const visibleNames = (agents: Agent.Info[]) => agents.filter((a) => !a.hidden).map((a) => a.name)

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts>
  readonly loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts>
  readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const jobs = yield* Jobs.Service
    const runner = Effect.fn("SessionPrompt.runner")(function* () {
      return yield* EffectBridge.make()
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      const seen = new Set<SessionID>()
      function cancelTree(current: SessionID): Effect.Effect<void, never, never> {
        return Effect.gen(function* () {
        if (seen.has(current)) return
        seen.add(current)

        // Stop the parent before enumerating children so it cannot launch more work.
        yield* state.cancel(current)

        const running = yield* jobs.list({ sessionID: current })
        yield* Effect.forEach(
          running.filter((job) => job.status === "running" || job.status === "stalled"),
          (job) => jobs.kill({ sessionID: current, jobID: job.id }),
          { discard: true },
        )

        const children = yield* sessions.children(current)
        yield* Effect.forEach(children, (child) => cancelTree(child.id), { discard: true })
        })
      }
      yield* cancelTree(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: PromptInput["parts"] = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (seen.has(name)) return
          seen.add(name)
          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : AppFileSystem.mimeType(filepath),
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: MessageV2.WithParts[]
      providerID: ProviderID
      modelID: ModelID
    }) {
      if (input.session.parentID) return

      const real = (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      // Always recoverable from the first real user prompt (fork timeline already shows this).
      const provisional = Session.titleFromUserParts(firstUser.parts)
      const stillDefault = Session.isDefaultTitle(input.session.title)
      const stillProvisional = !!provisional && input.session.title === provisional
      // Only (re)title while still placeholder or the early provisional we set ourselves.
      if (!stillDefault && !stillProvisional) return
      if (!provisional && stillDefault) return

      const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      // Prefer a short LLM title; fall back to the first user prompt so the session list
      // never stays stuck on "New session - <iso>" (restore/switch was unusable vs fork).
      let next = provisional
      const ag = yield* agents.get("title")
      if (ag) {
        const mdl = yield* Effect.gen(function* () {
          if (ag.model) return yield* provider.getModel(ag.model.providerID, ag.model.modelID)
          const small = yield* provider.getSmallModel(input.providerID)
          if (small) return small
          return yield* provider.getModel(input.providerID, input.modelID)
        }).pipe(Effect.catchCause(() => Effect.succeed(undefined as Provider.Model | undefined)))
        if (mdl) {
          const msgs = onlySubtasks
            ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
            : yield* MessageV2.toModelMessagesEffect(context, mdl, toolReplayOptions(yield* config.get())).pipe(
                Effect.catchCause((cause) => {
                  elog.error("title model messages failed", { error: Cause.squash(cause) })
                  return Effect.succeed([] as ModelMessage[])
                }),
              )
          if (msgs.length > 0 || onlySubtasks) {
            const text = yield* llm
              .stream({
                agent: ag,
                user: firstInfo,
                system: [],
                small: true,
                tools: {},
                model: mdl,
                sessionID: input.session.id,
                retries: 2,
                outputTokenMax: 512,
                messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
              })
              .pipe(
                Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
                Stream.map((e) => e.text),
                Stream.mkString,
                Effect.catchCause((cause) => {
                  elog.error("title generation failed", { error: Cause.squash(cause) })
                  return Effect.succeed("")
                }),
              )
            const cleaned = text
              .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
              .split("\n")
              .map((line) => line.trim())
              .find((line) => line.length > 0)
            if (cleaned) {
              next = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
            }
          }
        }
      } else if (stillDefault && provisional) {
        elog.debug("title agent missing; using first user prompt as title")
      }

      if (!next || next === input.session.title) return
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: next })
        .pipe(Effect.catchCause((cause) => elog.error("failed to set title", { error: Cause.squash(cause) })))
    })

    const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: {
      messages: MessageV2.WithParts[]
      agent: Agent.Info
      session: Session.Info
    }) {
      const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) return input.messages

      // Idempotency prevents a retry/reload from adding another transition part
      // with a new PartID, which would break the cached message prefix.
      const normalizeNL = (s: string) => s.replace(/\r\n/g, "\n")
      const hasSynthetic = (text: string) =>
        userMessage.parts.some(
          (p) =>
            p.type === "text" &&
            (p as MessageV2.TextPart & { synthetic?: boolean }).synthetic === true &&
            normalizeNL(p.text) === normalizeNL(text),
        )

      const userIndex = input.messages.findLastIndex((msg) => msg.info.id === userMessage.info.id)
      const previousMode = input.messages.slice(0, userIndex).findLast((msg) => msg.info.agent)?.info.agent
      // Mode transition (build_mode/plan_mode/reasoning_mode) or subagent role notify.
      // Canonical compare so plan↔plan_mode does not double-fire or miss switches.
      // Steady-state same identity: no re-inject (permissions enforce; keep KV prefix).
      const prevCanon = previousMode ? canonicalIdentity(previousMode) : undefined
      const nextCanon = canonicalIdentity(input.agent.name)
      // This per-session tracker survives compaction — the visible-message window
      // may no longer contain the previous agent after a fold.
      const prevTracked = lastInjectedMode.get(input.session.id) || (previousMode ?? "")
      const instruction =
        modeInstructionForTransition(prevTracked, input.agent.name) ??
        (prevCanon !== nextCanon ? roleInstructionForAgent(input.agent) : undefined)
      if (!instruction || hasSynthetic(instruction)) return input.messages
      lastInjectedMode.set(input.session.id, nextCanon)
      yield* elog.debug("mode transition", {
        previousMode,
        nextMode: input.agent.name,
        prevCanon,
        nextCanon,
        hasSynthetic: false,
      })
      const part = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: instruction,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: MessageV2.SubtaskPart
      model: Provider.Model
      lastUser: MessageV2.User
      sessionID: SessionID
      session: Session.Info
      msgs: MessageV2.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: MessageV2.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: MessageV2.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = visibleNames(yield* agents.list())
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies MessageV2.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
            return Effect.void
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies MessageV2.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies MessageV2.ToolPart)
      }

    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = visibleNames(yield* agents.list())
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* lastModel(input.sessionID))
            const userMsg: MessageV2.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: MessageV2.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: MessageV2.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const part: MessageV2.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: "bash",
              callID: ulid(),
              state: {
                status: "running",
                time: { start: Date.now() },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (!msg.time.completed) {
                msg.time.completed = Date.now()
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: Date.now() },
                  input: part.state.input,
                  title: "",
                  metadata: { output, description: "" },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  if (part.state.status === "running") {
                    part.state.metadata = { output, description: "" }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          // Exit with pure interrupts (Fiber.interrupt) → treat as success.
          // Other failures (errors, defects) → propagate but complete the tool part
          // first so it doesn't remain stuck in "running" status.
          if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
            if (part.state.status === "running") {
              part.state = {
                status: "error",
                error: Cause.squash(exit.cause) instanceof Error
                  ? (Cause.squash(exit.cause) as Error).message
                  : String(Cause.squash(exit.cause)),
                time: { start: part.state.time.start, end: Date.now() },
                metadata: part.state.metadata,
                input: part.state.input,
              }
              yield* sessions.updatePart(part)
            }
            return yield* Effect.failCause(exit.cause)
          }

          yield* finish

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderID,
      modelID: ModelID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.data.suggestions?.length ? ` Did you mean: ${err.data.suggestions.join(", ")}?` : ""
        yield* bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.data.providerID}/${err.data.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.failCause(exit.cause)
    })

    const lastModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel()
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent || (yield* agents.defaultAgent())
      const ag = yield* agents.get(agentName)
      if (!ag) {
        const available = visibleNames(yield* agents.list())
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const model = input.model ?? ag.model ?? (yield* lastModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider.getModel(model.providerID, model.modelID).pipe(Effect.catchDefect(() => Effect.void))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: MessageV2.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
        providerCacheKey: input.providerCacheKey,
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<MessageV2.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              // Non-text/plain data URLs — decode and convert to text.
              // convertDocument handles all formats: documents → markdown content,
              // media/binary → metadata (EXIF, size, format, duration, etc.).
              // DeepSeek and other text-only models reject file parts.
              const commaIdx = part.url.indexOf(",")
              if (commaIdx !== -1) {
                const base64 = part.url.slice(commaIdx + 1)
                const bytes = Buffer.from(base64, "base64")
                const text = yield* Effect.promise(() =>
                  convertDocument(new Uint8Array(bytes), part.filename ?? "file"),
                )
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text,
                  },
                ]
              }
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `[Attached file: ${part.filename ?? "file"} (${part.mime})]`,
                },
              ]
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              if (yield* fsys.isDir(filepath)) part.mime = "application/x-directory"

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              const fileExt = path.extname(filepath).toLowerCase().slice(1)
              if (part.mime === "text/plain" || isSupportedDocumentFormat(fileExt)) {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<MessageV2.Part>[] = [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (part.mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read directory", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${part.mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(
                      Effect.tapError((e) => Effect.sync(() => Log.Default.warn("bug: readFile for base64 failed", { filepath, error: String(e) }))),
                      Effect.catch(Effect.die),
                    )).toString("base64"),
                  mime: part.mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const parts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      // Append UTC timestamp once at message submission — static, never
      // re-injected by the prompt loop. Cache-stable because the text
      // is immutable after this DB write.
      const utcTimestamp = new Date().toISOString()
      for (const part of parts) {
        if (part.type === "text" && !(part as MessageV2.TextPart).synthetic) {
          part.text = part.text + "\n\nUTC: " + utcTimestamp
        }
      }

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts },
      )

      const parsed = MessageV2.Info.zod.safeParse(info)
      if (!parsed.success) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          issues: parsed.error.issues,
        })
      }
      parts.forEach((part, index) => {
        const p = MessageV2.Part.zod.safeParse(part)
        if (p.success) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          issues: p.error.issues,
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)

      return { info, parts }
    }, Effect.scoped)

    const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.prompt")(
      function* (input: PromptInput) {
        const session = yield* sessions.get(input.sessionID)
        yield* revert.cleanup(session)
        const message = yield* createUserMessage(input)
        yield* sessions.touch(input.sessionID)

        // Immediate list label from first user prompt (before assistant finishes / LLM title).
        // LLM polish still runs via ensureTitle on first stop while title is provisional.
        if (!session.parentID && Session.isDefaultTitle(session.title)) {
          const provisional = Session.titleFromUserParts(message.parts)
          if (provisional) {
            yield* sessions
              .setTitle({ sessionID: session.id, title: provisional })
              .pipe(
                Effect.catchCause((cause) =>
                  elog.error("failed to set provisional title", { error: Cause.squash(cause) }),
                ),
              )
          }
        }

        const permissions: Permission.Ruleset = []
        for (const [t, enabled] of Object.entries(input.tools ?? {})) {
          permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
        }
        if (permissions.length > 0) {
          session.permission = permissions
          yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
        }

        if (input.noReply === true) return message
        return yield* loop({ sessionID: input.sessionID })
      },
    )

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user")
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 })
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop = Effect.fn("SessionPrompt.run")(
      function* (sessionID: SessionID) {
        const ctx = yield* InstanceState.context
        const slog = elog.with({ sessionID })
        let structured: unknown | undefined
        let step = 0
        /** Cached filterCompactedEffect result — messages are immutable within a
          * runLoop except for new tool results appended at the end. Reusing this
          * avoids re-paginating the entire history on every tool-using loop step. */
        let cachedMsgs: MessageV2.WithParts[] | undefined
        let lastKnownId: string | undefined
        /** Cached tool resolution — tool set is stable across loop iterations
          * within a single turn (same agent, model, session, provider). */
        let cachedTools: Record<string, AITool> | undefined
        /** Agent (mode) whose ACL the cached tool closures were resolved with.
          * Invalidated when the agent changes mid-runLoop (planexit/reasoning*). */
        let cachedToolsAgent: string | undefined
        /** In-memory only for the current runLoop; DB-backed
          * {@link SessionCompaction.hasPendingSummaryRequest} survives restarts. */
        let pendingSummaryResponse = false
        /** Epistemic floor of the current turn's evidence chain.
          * Starts at Inferred (model memory), upgraded to Exact
          * only after session-read.  Resets each turn. */
        let evidenceFloor: import("../session/constitution").InfoMark = "Inferred"
        let titleRequested = false
        const session = yield* sessions.get(sessionID)

        /**
         * Capture an LLM-authored checkpoint on an isolated branch. The request
         * and response never become Message/Part rows, so normal M is unchanged.
         */
        const maybeCaptureSidecar = (input: {
          visible: MessageV2.WithParts[]
          model: Provider.Model
          agent: Agent.Info
          cacheIdentity: Agent.Info
          user: MessageV2.User
          checkpoint: CheckpointData
          afterAssistant?: MessageV2.WithParts
        }) =>
          Effect.gen(function* () {
            if (input.afterAssistant && !SessionCompaction.isAssistantTurnComplete(input.afterAssistant)) return false
            if (sidecarInFlight.has(sessionID)) return false
            // Rate-limit: cooldown between sequential captures to avoid
            // excessive LLM calls during rapid-fire short turns.
            const lastCapture = lastSidecarCapture.get(sessionID)
            if (lastCapture !== undefined && Date.now() - lastCapture < SIDECAR_COOLDOWN_MS) return false
            const threshold = summaryWindowLimit({
              cfg: yield* config.get(),
              model: input.model,
              target: SessionCompaction.SUMMARY_INTERVAL_TOKENS,
            })
            const previous = IncrementalCheckpoint.latestOpen(sessionID)
            const openTokens = SessionCompaction.computeOpenWindowTokens(input.visible, previous?.toMessageID)
            if (openTokens < threshold) return false
            // Pre-flight: full request fit ≈ open content/4 + 10k overhead
            // (system/tools/framing). Tokenizer not used — undercounts providers.
            // usable() reserves headroom; sidecar is toolChoice:none (no output budget).
            const requestTokens = estimateRequestTokens(openTokens)
            const usableTokens = usable({ cfg: yield* config.get(), model: input.model })
            if (requestTokens >= usableTokens) {
              yield* slog.debug("sidecar checkpoint skipped: request exceeds model context", {
                openTokens,
                requestTokens,
                usable: usableTokens,
              })
              return false
            }
            const boundary = previous?.toMessageID
            const start = boundary ? input.visible.findIndex((m) => m.info.id === boundary) + 1 : 0
            const range = input.visible.slice(Math.max(0, start))
            if (!range.length) return false
            sidecarInFlight.add(sessionID)
            return yield* Effect.gen(function* () {
              // Summarize **this open range only** — not the entire checkpoint M.
              // Full M dilutes attention and yields 3-sentence stubs; old inject
              // geometry was always the window being summarized.
              const rangeModel = yield* MessageV2.toModelMessagesWithCountsEffect(
                range,
                input.model,
                toolReplayOptions(yield* config.get()),
              )
              const lastSv = previous?.body
                ? SessionCompaction.extractSemanticVector(previous.body)
                : undefined
              // Generous output for a full 4-section memory body (not chat brevity).
              const summaryOutCap = Math.min(8_192, input.model.limit.output || 8_192)
              // Use cacheIdentity for agent ACL/identity when present (sidecar branch).
              const sidecarAgent = input.cacheIdentity ?? input.agent
              let body = yield* llm
                .stream({
                  user: input.user,
                  agent: sidecarAgent,
                  permission: session.permission,
                  sessionID,
                  providerCacheKey: input.user.providerCacheKey
                    ? `${input.user.providerCacheKey}:sidecar`
                    : undefined,
                  system: [...input.checkpoint.systemPrompt],
                  messages: [
                    ...rangeModel.messages,
                    { role: "user", content: SessionCompaction.summaryRequestProse(lastSv) },
                  ],
                  tools: {},
                  toolChoice: "none",
                  model: input.model,
                  outputTokenMax: summaryOutCap,
                })
                .pipe(
                  Stream.filter((event): event is Extract<LLM.Event, { type: "text-delta" }> => event.type === "text-delta"),
                  Stream.map((event) => event.text),
                  Stream.mkString,
                  Effect.catchCause((cause) => {
                    slog.debug("sidecar checkpoint capture failed", { error: Cause.pretty(cause) })
                    return Effect.succeed("")
                  }),
                )
              const gaps = SessionCompaction.diagnoseSummaryGaps(body)
              if (gaps.length > 0) {
                yield* slog.info("sidecar summary gaps — attempting gap-fill", {
                  bodyLen: body.length,
                  gaps,
                  openTokens,
                  rangeMessages: range.length,
                })
                // One-shot gap-fill: ask model to complete only the deficient sections.
                // Much cheaper than regenerating the full range — no tools, no system prefix.
                const gapFillPrompt = SessionCompaction.gapFillRequest(body, gaps)
                const fillResponse = yield* llm
                  .stream({
                    user: input.user,
                    agent: sidecarAgent,
                    permission: session.permission,
                    sessionID,
                    system: [], // no system prefix — focused micro-task
                    messages: [
                      { role: "assistant", content: body },
                      { role: "user", content: gapFillPrompt },
                    ],
                    tools: {},
                    toolChoice: "none",
                    model: input.model,
                    outputTokenMax: Math.min(2_048, input.model.limit.output || 2_048),
                  })
                  .pipe(
                    Stream.filter((event): event is Extract<LLM.Event, { type: "text-delta" }> => event.type === "text-delta"),
                    Stream.map((event) => event.text),
                    Stream.mkString,
                    Effect.catchCause((cause) => {
                      slog.debug("sidecar gap-fill failed", { error: Cause.pretty(cause) })
                      return Effect.succeed("")
                    }),
                  )
                const merged = SessionCompaction.mergeSummarySections(body, fillResponse)
                if (!SessionCompaction.isValidSummaryBody(merged)) {
                  yield* slog.warn("sidecar gap-fill insufficient — rejecting", {
                    originalLen: body.length,
                    fillLen: fillResponse.length,
                    mergedLen: merged.length,
                    remainingGaps: SessionCompaction.diagnoseSummaryGaps(merged),
                  })
                  return false
                }
                yield* slog.info("sidecar gap-fill succeeded", {
                  originalLen: body.length,
                  fillLen: fillResponse.length,
                  mergedLen: merged.length,
                })
                body = merged
              }
              // Exact: write/edit/multiedit tool filediffs in range + CodeGraph on those paths.
              // Fossil is rollback only — not used here. Soft-fail enrich, keep body.
              const beforeMessages =
                start > 0 ? input.visible.slice(0, Math.max(0, start)) : []
              const enrichment = yield* summary
                .enrichRange({ sessionID, messages: range, beforeMessages })
                .pipe(
                  Effect.catchCause((cause) => {
                    slog.warn("sidecar Exact enrich failed (tool diffs/codegraph); storing body without handles", {
                      error: Cause.pretty(cause),
                    })
                    return Effect.succeed({ diffs: [], impact: undefined })
                  }),
                )
              // Old tested product: Inferred body + system Exact (range / diffs / CG).
              // Placement only differs: project_checkpoint + UI panel, not agent M.
              const checkpointID = ulid()
              const fromID = range[0].info.id
              const toID = range[range.length - 1].info.id
              if (!SessionCompaction.isValidSummaryBody(body)) {
                yield* slog.warn("sidecar rejecting invalid summary body", {
                  bodyLen: body.length,
                  gaps: SessionCompaction.diagnoseSummaryGaps(body),
                })
                return false
              }
              IncrementalCheckpoint.save({
                id: checkpointID,
                sessionID,
                fromMessageID: fromID,
                toMessageID: toID,
                predecessorID: previous?.id,
                providerID: input.model.providerID,
                modelID: input.model.id,
                agent: input.cacheIdentity.name,
                body,
                diffs: enrichment.diffs,
                impact: enrichment.impact,
              })
              // Print full old-style s for the user; synthetic+ignored → not agent M.
              const displayText = SessionCompaction.formatLayer1SummaryDisplay({
                checkpointID,
                fromID,
                toID,
                sessionID,
                body,
                diffs: enrichment.diffs,
                impact: enrichment.impact,
              })
              const displayMsg = yield* sessions.updateMessage({
                id: MessageID.ascending(),
                role: "user",
                sessionID,
                agent: input.cacheIdentity.name,
                model: {
                  providerID: input.model.providerID,
                  modelID: input.model.id,
                },
                time: { created: Date.now() },
              })
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: displayMsg.id,
                sessionID,
                type: "text",
                text: displayText,
                synthetic: true,
                ignored: true,
              })
              yield* slog.info("sidecar checkpoint captured", {
                openTokens,
                threshold,
                fromID,
                toID,
                checkpointID,
                toolDiffFiles: enrichment.diffs?.length ?? 0,
                hasCodeGraph: !!enrichment.impact,
                displayMessageID: displayMsg.id,
              })
              lastSidecarCapture.set(sessionID, Date.now())
              return true
            }).pipe(Effect.ensuring(Effect.sync(() => sidecarInFlight.delete(sessionID))))
          })

        /**
         * Layer-2 fold (zero LLM tokens) when **model usable context** is full —
         * NOT at Layer-1's 64k summary cadence.
         *
         * 1M model → work with hundreds of k of M; s still taken every ~64k open
         * via sidecar. Compact only when full visible content approaches usable().
         * Never fold on the same stop as a new s; never with exactly one open s.
         */
        const maybeCompactCadence = (input: {
          model: Provider.Model
          agent: string
          msgs?: MessageV2.WithParts[]
        }) =>
          Effect.gen(function* () {
            const openSidecars = IncrementalCheckpoint.listOpen(sessionID).length
            // Hold fold until ≥2 open s rows (or pure history with zero sidecars).
            if (openSidecars === 1) {
              yield* slog.info("layer2.cadence.skip_single_sidecar", {
                sessionID,
                openSidecars,
              })
              return false
            }
            const visible =
              input.msgs ?? (yield* MessageV2.filterCompactedEffect(sessionID))
            const cfg = yield* config.get()
            // Full visible M (chars/4) — not open-since-last-s.
            const visibleTokens = SessionCompaction.computeOpenWindowTokens(visible)
            // Compact target = model usable window (e.g. ~850k on 1M), not 65_536.
            // Layer-1 SUMMARY_INTERVAL is only for sidecar s cadence.
            const compactTarget = usable({ cfg, model: input.model })
            if (
              compactTarget <= 0 ||
              !needsContentCompaction({
                cfg,
                openTokens: visibleTokens,
                target: compactTarget,
              })
            ) {
              return false
            }
            yield* slog.info("layer2.cadence.compact", {
              sessionID,
              visibleTokens,
              openSidecars,
              compactTarget,
              modelContext: input.model.limit.context,
              summaryInterval: SessionCompaction.SUMMARY_INTERVAL_TOKENS,
            })
            // Recent trim inside compact (no-s case) still uses Layer-1 interval floor.
            yield* compaction.compact({
              sessionID,
              model: { providerID: input.model.providerID, modelID: input.model.id },
              agent: input.agent,
              threshold: summaryWindowLimit({
                cfg,
                model: input.model,
                target: SessionCompaction.SUMMARY_INTERVAL_TOKENS,
              }),
            })
            yield* Checkpoint.remove(sessionID)
            // Reset sidecar cooldown: compaction opens a fresh message window,
            // so a new sidecar summary is appropriate on the next turn.
            lastSidecarCapture.delete(sessionID)
            cachedMsgs = undefined
            lastKnownId = undefined
            return true
          })

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* slog.info("loop", { step })

          let msgs: MessageV2.WithParts[]
          if (cachedMsgs && lastKnownId) {
            const newMsgs = MessageV2.messagesSince(sessionID, lastKnownId)
            msgs = [...cachedMsgs, ...newMsgs]
            if (newMsgs.length > 0) {
              cachedMsgs = msgs
              lastKnownId = msgs[msgs.length - 1]?.info.id ?? lastKnownId
            }
          } else {
            msgs = yield* MessageV2.filterCompactedEffect(sessionID)
            cachedMsgs = msgs
            lastKnownId = msgs[msgs.length - 1]?.info.id
          }
          yield* slog.debug("prepare", { step, stage: "messages-ready", messageCount: msgs.length })

          // Filter out orphaned interrupted tool parts — they were never completed
          // and their partial output should not appear in the model context.
          // Fast path: skip expensive map+filter if no message has orphaned tool parts.
          const hasOrphanedTools = msgs.some((msg) =>
            msg.parts.some((p) =>
              p.type === "tool" && p.state?.status === "error" && p.state?.metadata?.interrupted
            )
          )

          if (hasOrphanedTools) {
            msgs = msgs.map((msg) => ({
              ...msg,
              parts: msg.parts.filter((p) =>
                !(p.type === "tool" && p.state?.status === "error" && p.state?.metadata?.interrupted === true)
              ),
            }))
          }
          // Keep cache in sync — msgs.map() creates new message objects.
          // Without this, mutations to msgs (system-reminder, background-jobs)
          // are lost when cachedMsgs is reused on the next iteration.
          cachedMsgs = msgs

          // Restore pending flag across runLoop restarts from DB.
          if (!pendingSummaryResponse && SessionCompaction.hasPendingSummaryRequest(msgs)) {
            pendingSummaryResponse = true
          }

          let lastUser: MessageV2.User | undefined
          let lastAssistant: MessageV2.Assistant | undefined
          let lastFinished: MessageV2.Assistant | undefined
          let tasks: MessageV2.SubtaskPart[] = []
          for (let i = msgs.length - 1; i >= 0; i--) {
            const msg = msgs[i]
            // Layer-1 display panels are user-role UI only — never the turn parent.
            if (
              !lastUser &&
              msg.info.role === "user" &&
              !SessionCompaction.isLayer1SummaryMessage(msg)
            ) {
              lastUser = msg.info
            }
            if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info
            if (!lastFinished && msg.info.role === "assistant" && msg.info.finish) lastFinished = msg.info
            if (lastUser && lastFinished) break
            const task = msg.parts.filter((part) => part.type === "subtask")
            if (task && !lastFinished) tasks.push(...task)
          }

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          const lastUserMsg = msgs.findLast((m): m is MessageV2.WithParts & { info: MessageV2.User } => m.info.id === lastUser.id)
          const summaryAttempt = !!lastUserMsg && SessionCompaction.hasPendingSummaryRequest(msgs)
          const terminalSummaryAttempt =
            !!lastUserMsg &&
            SessionCompaction.isSummaryRequestMessage(lastUserMsg) &&
            SessionCompaction.isTerminalSummaryRequestMessage(lastUserMsg)

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains tool calls.
          // Keep the loop running so tool results can be sent back to the model.
          // Skip provider-executed tool parts — those were fully handled within the
          // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
          const hasToolCalls =
            lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

          // Resume only after a completed summary assistant (reasoning closed).
          if (
            lastAssistant?.summary &&
            lastUser.id < lastAssistant.id &&
            lastAssistantMsg &&
            SessionCompaction.isAssistantTurnComplete(lastAssistantMsg)
          ) {
            yield* slog.info("legacy layer1 summary is terminal", { summaryID: lastAssistant.id })
            break
          }

          // Terminal work turn complete → optional Layer-1 inject, then exit.
          // Never inject while tool-calls / open reasoning still run.
          if (
            lastAssistantMsg &&
            SessionCompaction.isAssistantTurnComplete(lastAssistantMsg) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant!.id &&
            !summaryAttempt
          ) {
            yield* slog.info("exiting loop", { step })
            break
          }

          step++
          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          yield* slog.debug("prepare", { step, stage: "model-ready", providerID: model.providerID, modelID: model.id })
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            continue
          }

          // Layer-2 cadence while loop continues (e.g. tools). Stop-path compact
          // is handled after sidecar in result==="stop" (break used to skip this).
          if (
            (lastFinished || lastAssistant) &&
            lastFinished?.summary !== true &&
            !pendingSummaryResponse &&
            !SessionCompaction.hasPendingSummaryRequest(msgs) &&
            (yield* maybeCompactCadence({ model, agent: lastUser.agent, msgs }))
          ) {
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = visibleNames(yield* agents.list())
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          // Real identity (build_mode / coder_agent / …). Protocol is shared mdc.
          // Role = synthetic notify on switch; ACL = execute on real `agent`.
          const cacheAgent = providerIdentityForMode(agent, (yield* agents.get("build_mode")) ?? agent)
          // Primary modes share the same system prefix — no agentName in
          // checkpoint key so mode switches reuse the cached prompt. Subagents
          // (coder, explorer, …) keep separate checkpoints (different tools).
          const checkpointAgentName = isPrimaryModeIdentity(cacheAgent.name) ? undefined : cacheAgent.name
          const maxSteps = agent.steps ?? Infinity
          const isLastStep = step >= maxSteps
          msgs = yield* insertReminders({ messages: msgs, agent, session })

          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model,
              agentName: agent.name,
              // Safety path for processor emergency compact: content/4 + 10k overhead.
              contentTokenEstimate: estimateRequestTokens(estimateContentTokens(msgs, model)),
              evidenceFloor,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))
          yield* slog.debug("prepare", { step, stage: "assistant-ready", agent: agent.name })

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

            let tools: Record<string, AITool>
            // Layer-1 summary turn: prose only. Full tools let the model Read/bash
            // instead of writing SVM/goal/decisions. The accepted `summary` flag
            // is set only after validation, so use the persisted request state here.
            if (summaryAttempt) {
              tools = {}
            } else if (cachedTools && cachedToolsAgent === agent.name) {
              tools = cachedTools
            } else {
              tools = yield* SessionTools.resolve({
                agent,
                providerAgent: cacheAgent,
                session,
                model,
                processor: handle,
                bypassAgentCheck,
                messages: msgs,
                promptOps: yield* ops(),
              })
              if (lastUser.format?.type === "json_schema") {
                tools["StructuredOutput"] = createStructuredOutputTool({
                  schema: lastUser.format.schema,
                  onSuccess(output) {
                    structured = output
                  },
                })
              }
              cachedTools = tools
              cachedToolsAgent = agent.name
            }
            yield* slog.debug("prepare", {
              step,
              stage: "tools-ready",
              toolCount: Object.keys(tools).length,
              summaryTurn: summaryAttempt,
            })

            // summarize() moved to common step-1 block before task dispatch

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            // Inject background job notes from the JobManager (completed + running + CPU warning)
            const jobsNote = yield* Effect.gen(function* () {
              // JobManager is optional — silently skip if not provided in the layer
              try {
                const svc = yield* Effect.serviceOption(Jobs.Service)
                if (svc._tag === "None") return ""
                return yield* svc.value.drainBackgroundNote({ sessionID })
              } catch (e) {
                Log.Default.warn("bug: failed to drain background jobs", { error: String(e), sessionID })
                return ""
              }
            })
            // [KV-CACHE] Never mutate existing user text parts in place.
            // In-place prepends change part fingerprints mid-session → full prefix
            // invalidation from that message forward (hit_ratio collapses).
            // Inject as a separate synthetic part instead (idempotent by content prefix).
            if (jobsNote) {
              const freshUserMsg = msgs.findLast((m) => m.info.role === "user")
              if (freshUserMsg) {
                const alreadyNoted = freshUserMsg.parts.some(
                  (p) =>
                    p.type === "text" &&
                    (p as MessageV2.TextPart).synthetic === true &&
                    p.text.startsWith("<background-jobs>"),
                )
                if (!alreadyNoted) {
                  const notePart = yield* sessions.updatePart({
                    id: PartID.ascending(),
                    messageID: freshUserMsg.info.id,
                    sessionID: freshUserMsg.info.sessionID,
                    type: "text" as const,
                    text: `<background-jobs>\n${jobsNote}\n</background-jobs>`,
                    synthetic: true,
                  })
                  // Append — do not unshift over the user's original part 0.
                  freshUserMsg.parts.push(notePart)
                }
              }
            }

            const format = lastUser.format ?? { type: "text" as const }

            // Current identity must match the checkpoint's identityFingerprint.
            // Kernel / agent-prompt migrations invalidate checkpoints so we never
            // pair a new identity prefix with path system assembled under an old one.
            const reasoningPrefixForIdentity = ProviderTransform.systemPromptPrefix(model)
            // Kernel identity (reasoning_prompt.txt) is the only byte-stable anchor.
            // Agent prompt is mode-specific and delivered via <system-reminder> notify —
            // never part of the identity fingerprint (would break KV-cache on mode switch).
            const cleanIdentity = reasoningPrefixForIdentity

            // Attempt to load encrypted checkpoint for this session+model.
            // Invalidated on compaction, new session, structured-output flip,
            // or identity fingerprint mismatch (kernel/agent prompt change).
            const checkpoint = yield* Checkpoint.load({
              sessionID,
              providerID: model.providerID,
              modelID: model.id,
              projectID: ctx.project.id,
              agentName: checkpointAgentName,
            }).pipe(Effect.catch(() => Effect.succeed(null)))
            const checkpointHasStructuredPrompt = checkpoint?.systemPrompt.at(-1) === STRUCTURED_OUTPUT_SYSTEM_PROMPT
            const checkpointIdentityOk = checkpoint
              ? Checkpoint.isIdentityCompatible(checkpoint, cleanIdentity)
              : false
            if (checkpoint && !checkpointIdentityOk) {
              Log.Default.info("checkpoint identity mismatch — rebuilding system", {
                sessionID,
                agent: agent.name,
                providerID: model.providerID,
                modelID: model.id,
              })
            }
            // Use checkpoint for everything EXCEPT structured output prompt mismatch.
            // Structured prompt is a one-line append/remove — no reason to drop the
            // entire checkpoint and reassemble skills/env/rules/instructions.
            const checkpointUsable =
              checkpoint && checkpointIdentityOk ? checkpoint : undefined
            // Track whether only the structured prompt differs (incremental fix below).
            const structuredPromptMismatch =
              checkpointUsable &&
              checkpointHasStructuredPrompt !== (format.type === "json_schema")
            yield* slog.debug("prepare", { step, stage: "checkpoint-ready", reused: !!checkpointUsable })

            const [skills, env, instructions, rules] = checkpointUsable && !structuredPromptMismatch
              ? [undefined, [] as string[], [] as string[], [] as string[]] as const
              : checkpointUsable && structuredPromptMismatch
                ? [undefined, [] as string[], [] as string[], [] as string[]] as const  // also skip: only prompt differs
                : yield* Effect.all([
                    // Skills are a complete, agent-independent catalog in the system
                    // prefix. Runtime ACL gates each skill name when it is invoked.
                    sys.skills(),
                    Effect.sync(() => sys.environment(model)),
                    instruction.system().pipe(Effect.orDie),
                    instruction.rules().pipe(Effect.orDie),
                  ])
            // Stable-first path: rules → skills → env → AGENTS (instructions last).
            // ADID rules/skills early; env paths + project AGENTS last (multi-project KV).
            // Must match assemblePathSystem — do not reintroduce skills→env→rules drift.
            const system = checkpointUsable
              ? [...checkpointUsable.systemPrompt]
              : assemblePathSystem({
                  skills: skills || undefined,
                  env,
                  rules,
                  instructions,
                })
            if (!checkpointUsable && format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            // Incremental structured output fix: adjust prompt without full path rebuild.
            if (structuredPromptMismatch) {
              if (format.type === "json_schema") {
                // Need prompt → add it (not present in checkpoint)
                system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
              } else {
                // Don't need prompt → remove it (remnant from checkpoint)
                const last = system.pop()
                if (last !== STRUCTURED_OUTPUT_SYSTEM_PROMPT) {
                  // Safety: if pop removed the wrong thing, restore it
                  if (last !== undefined) system.push(last)
                  Log.Default.warn("bug: structured output prompt mismatch — expected prompt at end of system", {
                    sessionID,
                    agent: cacheAgent.name,
                  })
                }
              }
            }

            // Checkpoint message reuse: longest ordered prefix with matching IDs.
            // History is append-only; edited messages get a new ID or invalidate
            // the checkpoint before this path runs. Suffix is re-converted.
            // Path system stays frozen until compact — only messages use delta logic.
            //
            // CRITICAL: ModelMessage[] is NOT 1:1 with messageIDs. An assistant
            // message with tool calls expands to assistant + role:"tool" result
            // message(s). Slicing messages by prefixLen (DB count) drops tool
            // results → AI_MissingToolResultsError. Use modelMessageCounts.
            let modelMsgs: ModelMessage[]
            // Diff/checkpoint IDs are plain strings (CheckpointData.messageIDs); do not brand.
            let modelMessageIDs: string[] = msgs.map((m) => m.info.id)
            if (checkpointUsable) {
              const prefixLen = Checkpoint.reusablePrefixLength(msgs, checkpointUsable)
              const prefixModel = Checkpoint.takeModelPrefix(checkpointUsable, prefixLen)
              if (prefixModel === null) {
                // Legacy checkpoint without modelMessageCounts — full reconvert.
                // modelMessageCounts parallel to messageIDs maps DB messages to ModelMessage
                // entries. Without it, slicing by DB prefix length drops tool results →
                // AI_MissingToolResultsError. Full reconversion is correct but wasteful.
                Log.Default.warn("bug: legacy checkpoint without modelMessageCounts — full reconvert needed", {
                  sessionID,
                  agent: cacheAgent.name,
                  modelID: model.id,
                  providerID: model.providerID,
                })
                modelMsgs = yield* MessageV2.toModelMessagesEffect(
                  msgs,
                  model,
                  toolReplayOptions(yield* config.get()),
                )
              } else {
                const suffix = msgs.slice(prefixLen)
                const suffixModel = suffix.length
                  ? yield* MessageV2.toModelMessagesEffect(
                      suffix,
                      model,
                      toolReplayOptions(yield* config.get()),
                    )
                  : []
                modelMsgs = [...prefixModel, ...suffixModel]
                modelMessageIDs = [
                  ...checkpointUsable.messageIDs.slice(0, prefixLen),
                  ...suffix.map((m) => m.info.id),
                ]
              }
            } else {
              modelMsgs = yield* MessageV2.toModelMessagesEffect(
                msgs,
                model,
                toolReplayOptions(yield* config.get()),
              )
            }

            yield* slog.debug("prepare", { step, stage: "dispatch" })
            // cacheAgent = build identity for mode transitions (same KV schema as HEAD cacheIdentity).
            const result = yield* handle.process({
              user: lastUser,
              agent: cacheAgent,
              permission: session.permission,
              sessionID,
              parentSessionID: session.parentID,
              providerCacheKey: lastUser.providerCacheKey,
              system,
              messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools,
              model,
              toolChoice: format.type === "json_schema" ? "required" : undefined,
              checkpoint: !!checkpointUsable,
            })

            // Capture the provider-facing system after process():
            // llm.ts:chat.system.transform may have modified it by reference.
            const systemForDiff = [...system]

            // Diff logging — suffix-only format (O(new messages), not full history).
            // Cold restore with checkpoint: skip prev re-format of entire checkpoint;
            // remember current suffix so the *next* turn has a cheap baseline.
            const cfg = yield* config.get()
            if (cfg.diff_requests !== false) {
              const diffMeta: RequestDiff.DiffMeta = {
                sessionID,
                modelID: model.id,
                providerID: model.providerID,
                turn: msgs.filter((m) => m.info.role === "user").length,
                agent: agent.name,
                timestamp: Date.now(),
              }
              // Suffix-only: DB prefix → model-message end index (tool calls expand 1:N).
              const dbPrefix =
                checkpointUsable != null
                  ? Checkpoint.reusablePrefixLength(msgs, checkpointUsable)
                  : 0
              const modelFrom =
                checkpointUsable != null
                  ? (Checkpoint.modelMessageEnd(checkpointUsable, dbPrefix) ?? 0)
                  : 0
              const formatted = RequestDiff.formatRequest(
                systemForDiff,
                modelMsgs,
                diffMeta,
                modelMessageIDs,
                { fromIndex: modelFrom, preferNewest: true },
              )
              const remembered = RequestDiff.getPreviousFormatted(diffMeta)
              const prevText = remembered?.text
              const prevMeta = remembered?.meta
              // Do NOT re-format full checkpoint.messages as prev — that re-walked
              // the entire model history on every cold restore.
              if (prevText && prevMeta) {
                const diff = RequestDiff.diffRequest(prevText, formatted, prevMeta, diffMeta)
                if (diff) RequestDiff.writeDiff(diff, diffMeta)
              }
              RequestDiff.rememberFormatted(formatted, diffMeta)
            }

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              if (format.type === "json_schema") {
                handle.message.error = new MessageV2.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (summaryAttempt) {
              // SYSTEM Exact stamp: digits from inject HTML + this message id.
              // Nail and hammer — not microscope (model does not invent IDs).
              const parentParts = msgs.find((m) => m.info.id === lastUser.id)?.parts ?? []
              let fromId: string | undefined
              let toId: string | undefined
              for (const p of parentParts) {
                if (p.type !== "text" || typeof (p as { text?: string }).text !== "string") continue
                const m = (p as { text: string }).text.match(
                  /<!-- summary-range from_id="([^"]+)" to_id="([^"]+)" session_id="([^"]+)" -->/,
                )
                if (m) {
                  fromId = m[1]
                  toId = m[2]
                  break
                }
              }
              const asstParts = (yield* MessageV2.filterCompactedEffect(sessionID)).find(
                (m) => m.info.id === msg.id,
              )?.parts
              // Inferred body only — ignore Exact stamp / other ignored synthetics.
              const summaryBody = (asstParts ?? [])
                .filter(
                  (p) =>
                    p.type === "text" &&
                    !(p as { ignored?: boolean }).ignored &&
                    typeof (p as { text?: string }).text === "string" &&
                    !(p as { text: string }).text.startsWith("--- Exact (system) ---"),
                )
                .map((p) => (p as { text: string }).text.trim())
                .join("\n")
                .trim()
              const summaryDone =
                !handle.message.error &&
                !!handle.message.finish &&
                !["tool-calls", "unknown"].includes(handle.message.finish)
              const hasSummaryBody = SessionCompaction.isValidSummaryBody(summaryBody)
              const accepted = summaryDone && hasSummaryBody && !!fromId && !!toId

              if (!accepted) {
                const attempt = SessionCompaction.summaryAttemptCount(msgs, lastUser.id) + 1
                if (attempt < SessionCompaction.MAX_SUMMARY_ATTEMPTS) {
                  yield* slog.warn("layer1.summary.retry", {
                    sessionID,
                    summaryID: msg.id,
                    attempt,
                    summaryDone,
                    bodyLen: summaryBody.length,
                    hasRange: !!fromId && !!toId,
                  })
                  pendingSummaryResponse = true
                  cachedMsgs = undefined
                  lastKnownId = undefined
                  return "continue" as const
                }
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  messageID: lastUser.id,
                  sessionID,
                  type: "text",
                  text: SessionCompaction.summaryTerminalMarker(),
                  synthetic: true,
                  ignored: true,
                })
                pendingSummaryResponse = false
                yield* slog.warn("layer1.summary.terminal", {
                  sessionID,
                  summaryID: msg.id,
                  attempt,
                  summaryDone,
                  bodyLen: summaryBody.length,
                  hasRange: !!fromId && !!toId,
                })
                return "break" as const
              }

              handle.message.summary = true
              yield* sessions.updateMessage(handle.message)
              pendingSummaryResponse = false
              const stamped = asstParts?.some(
                (p) =>
                  p.type === "text" &&
                  typeof (p as { text?: string }).text === "string" &&
                  (p as { text: string }).text.startsWith("--- Exact (system) ---"),
              )
              if (!stamped && fromId && toId) {
                // ignored:true — Exact digits stay in DB for tools / compact fold,
                // but must not enter model context. Same stamp helper as sidecar UI.
                yield* sessions.updatePart({
                  id: PartID.ascending(),
                  messageID: msg.id,
                  sessionID,
                  type: "text",
                  text: SessionCompaction.formatExactSystemStamp({
                    id: msg.id,
                    fromId,
                    toId,
                    sessionID,
                    idKey: "summary_message_id",
                  }),
                  synthetic: true,
                  ignored: true,
                })
              }
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(
                Effect.catchCause((cause) =>
                  slog.debug("layer1.summary.enrichment_failed", { sessionID, summaryID: msg.id, error: Cause.pretty(cause) }),
                ),
              )
              return "break" as const
            }

            // Tool-call chain: if the assistant turn ended with pending tool calls,
            // continue the loop so tool results can be fed back to the LLM in the
            // next iteration. `process()` returns "continue" for a normal tool step,
            // so this must not be nested below the result === "stop" error path.
            // Provider-executed tools were fully handled in-stream and need no re-loop.
            if (msg.finish === "tool-calls" || MessageV2.parts(msg.id).some((part) => part.type === "tool" && !part.metadata?.providerExecuted)) {
              // Tool execution updates parts of this assistant message in place.
              // The incremental cache only discovers new IDs, so it cannot observe
              // that mutation on the next loop iteration.
              cachedMsgs = undefined
              lastKnownId = undefined
              return "continue" as const
            }

            if (result === "stop") {
              // Layer 1 only after this assistant fully completed (reasoning closed).
              // Never inject mid-stream or mid-tool-loop — reasoning models require
              // the open turn to finish before any synthetic user message.
              const visibleAfter = yield* MessageV2.filterCompactedEffect(sessionID)
              const completedAsst = visibleAfter.find((m) => m.info.id === msg.id)
              // Publish normal M before opening the ephemeral sidecar branch.
              // Its disk copy is durability only; the sidecar receives this exact
              // model-ready state and cannot alter the main outcome.
              const converted = yield* MessageV2.toModelMessagesWithCountsEffect(
                visibleAfter,
                model,
                toolReplayOptions(yield* config.get()),
              )
              const checkpointData = {
                kind: Checkpoint.CHECKPOINT_KIND,
                version: Checkpoint.CHECKPOINT_VERSION,
                systemPrompt: checkpointUsable ? [...system] : cleanIdentity ? [cleanIdentity, ...system] : [...system],
                identityFingerprint: Checkpoint.identityFingerprint(cleanIdentity),
                messages: converted.messages,
                messageIDs: visibleAfter.map((item) => item.info.id),
                modelMessageCounts: converted.counts,
                model: { providerID: model.providerID, modelID: model.id },
                agent: cacheAgent.name,
                turn: step + 1,
                timestamp: Date.now(),
              } satisfies CheckpointData
              Checkpoint.publish({ sessionID, data: checkpointData })
              // Contract: summary only AFTER checkpoint is durable on disk (not fire-and-forget).
              yield* Checkpoint.persist({
                sessionID,
                projectID: ctx.project.id,
                data: checkpointData,
              })
              // Then: s outside M (ephemeral summary + Exact tool diffs/CodeGraph on range).
              const sidecarCaptured = yield* maybeCaptureSidecar({
                visible: visibleAfter,
                model,
                agent,
                cacheIdentity: cacheAgent,
                user: lastUser,
                checkpoint: checkpointData,
                afterAssistant: completedAsst,
              })
              // Never compact on the same stop as a new s — work continues with M
              // intact and s outside. Layer-2 runs on a later stop (and only when
              // ≥2 open sidecars, see maybeCompactCadence).
              if (!sidecarCaptured) {
                yield* maybeCompactCadence({
                  model,
                  agent: lastUser.agent,
                })
              } else {
                yield* slog.info("layer2.cadence.defer_after_sidecar", { sessionID })
              }
              if (!titleRequested) {
                titleRequested = true
                yield* title({
                  session,
                  modelID: lastUser.model.modelID,
                  providerID: lastUser.model.providerID,
                  history: msgs,
                }).pipe(
                  Effect.catchCause((cause) => slog.error("title generation failed", { error: Cause.squash(cause) })),
                  Effect.forkIn(scope),
                )
              }
              return "break" as const
            }
            if (result === "compact") {
              // Compact → message*. Next loop recomputes the open-window
              // counter: no summary after the star yet → counter = len(message*)/4.
              // The normal 64K target or a lower provider-safe fallback then applies.
              yield* compaction.compact({
                sessionID,
                model: lastUser.model,
                agent: lastUser.agent,
                threshold: summaryWindowLimit({
                  cfg: yield* config.get(),
                  model,
                  target: SessionCompaction.SUMMARY_INTERVAL_TOKENS,
                }),
              })
              // Invalidate checkpoint — the old checkpoint contains pre-compaction
              // message IDs that won't match the new compacted state.
              yield* Checkpoint.remove(sessionID)
              // Reset sidecar cooldown: fresh message window after compaction.
              lastSidecarCapture.delete(sessionID)
              cachedMsgs = undefined
              lastKnownId = undefined
              return "continue" as const
            }
            // Save encrypted checkpoint after successful turn.
            // publish() is sync inside save(); disk write is fire-and-forget.
            // Path system frozen when reusing checkpoint (KV continuity until compact).
            // Messages: reuse checkpoint prefix + convert only new/dirty suffix.
            const systemForCheckpoint = checkpointUsable
              ? [...system]
              : cleanIdentity ? [cleanIdentity, ...system] : [...system]
            const identityFp = Checkpoint.identityFingerprint(cleanIdentity)
            yield* Effect.forkIn(scope)(
              Effect.gen(function* () {
                // Reuse in-loop visible msgs when still valid — avoid a second
                // full visible hydrate just to save the checkpoint.
                const checkpointMsgs =
                  cachedMsgs && lastKnownId
                    ? [...cachedMsgs, ...MessageV2.messagesSince(sessionID, lastKnownId)]
                    : yield* MessageV2.filterCompactedEffect(sessionID)
                const prefixLen = checkpointUsable
                  ? Checkpoint.reusablePrefixLength(checkpointMsgs, checkpointUsable)
                  : 0
                // modelMessageCounts must stay parallel to messageIDs. Without
                // counts (legacy slot), reconvert the full set so the new slot
                // is accurate — never slice messages by DB prefix length.
                let fullModel: ModelMessage[]
                let modelMessageCounts: number[]
                const prefixModel =
                  checkpointUsable != null
                    ? Checkpoint.takeModelPrefix(checkpointUsable, prefixLen)
                    : null
                if (prefixModel !== null && checkpointUsable) {
                  const converted = yield* MessageV2.toModelMessagesWithCountsEffect(
                    checkpointMsgs.slice(prefixLen),
                    model,
                    toolReplayOptions(yield* config.get()),
                  )
                  fullModel = [...prefixModel, ...converted.messages]
                  modelMessageCounts = [
                    ...checkpointUsable.modelMessageCounts!.slice(0, prefixLen),
                    ...converted.counts,
                  ]
                } else {
                  const converted = yield* MessageV2.toModelMessagesWithCountsEffect(
                    checkpointMsgs,
                    model,
                    toolReplayOptions(yield* config.get()),
                  )
                  fullModel = converted.messages
                  modelMessageCounts = converted.counts
                }
                yield* Checkpoint.save({
                  sessionID,
                  projectID: ctx.project.id,
                  data: {
                    kind: Checkpoint.CHECKPOINT_KIND,
                    version: Checkpoint.CHECKPOINT_VERSION,
                    systemPrompt: systemForCheckpoint,
                    identityFingerprint: identityFp,
                    messages: fullModel,
                    messageIDs: checkpointMsgs.map((m) => m.info.id),
                    modelMessageCounts,
                    model: { providerID: model.providerID, modelID: model.id },
                agent: checkpointAgentName,
                    turn: step + 1,
                    timestamp: Date.now(),
                  },
                })
              }),
            )
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          if (outcome === "break") break
          continue
        }

        // pruning handled by compaction.compact() — no separate prune step
        return yield* lastAssistant(sessionID)
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      // SessionTools.resolve() yields services that are already provided by the enclosing layer.
      // The type system can't unify the requirements through ensureRunning, but they are satisfied.
      return yield* state.ensureRunning(
        input.sessionID,
        lastAssistant(input.sessionID),
        runLoop(input.sessionID) as Effect.Effect<MessageV2.WithParts>,
      )
    })

    const shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.shell")(
      function* (input: ShellInput) {
        const ready = yield* Latch.make()
        return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
      },
    )

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent ?? (yield* agents.defaultAgent())

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* lastModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = yield* agents.get(agentName)
      if (!agent) {
        const available = visibleNames(yield* agents.list())
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultAgent())) : agentName
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* lastModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
      })
      yield* bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Jobs.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Agent.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Bus.layer,
        CrossSpawnSpawner.defaultLayer,
      ),
    ),
  ),
)
const ModelRef = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(MessageV2.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  providerCacheKey: Schema.optional(Schema.String),
  parts: Schema.Array(
    Schema.Union([
      MessageV2.TextPartInput,
      MessageV2.FilePartInput,
      MessageV2.AgentPartInput,
      MessageV2.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
// `z.discriminatedUnion` erases the discriminated members' shapes back to
// `{}` when walked from the generic `z.ZodType` input. Restore the precise
// `parts` type from the exported Schema input types so callers see a proper
// tagged union.
type PartInputUnion =
  | MessageV2.TextPartInput
  | MessageV2.FilePartInput
  | MessageV2.AgentPartInput
  | MessageV2.SubtaskPartInput
export type PromptInput = Omit<Schema.Schema.Type<typeof PromptInput>, "parts"> & {
  parts: PartInputUnion[]
}

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {
  static readonly zod = zod(this)
}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(MessageV2.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export * as SessionPrompt from "./prompt"

