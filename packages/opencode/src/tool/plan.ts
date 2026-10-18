import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { sealUserText } from "@/session/user-seal"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Agent } from "@/agent/agent"
import { Instance } from "../project/instance"
import { type SessionID, MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./planexit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { invalidatePermissionCache } from "./permission-cache"
import PROMPT_BUILD_RAW from "../session/prompt/build.txt"
import PROMPT_PLAN_RAW from "../session/prompt/plan.txt"
import {
  loadSessionSettings,
  resolveAgentModel,
  resolveAgentVariant,
  type ModelRef,
} from "../session/session-settings"
import { gateLayerModel, readGlobalRecents, resolveGlobalHead } from "../session/global-recents"

// Same CRLF normalize as prompt.ts — hasSynthetic must match byte-for-byte.
const PROMPT_BUILD = PROMPT_BUILD_RAW.replace(/\r\n/g, "\n")
const PROMPT_PLAN = PROMPT_PLAN_RAW.replace(/\r\n/g, "\n")

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

async function transitionModel(
  agentName: string,
  target: Agent.Info | undefined,
  fallback: ModelRef & { variant?: string },
  context: { sessionID: string },
) {
  const transitionRecents = await readGlobalRecents()
  // Unified resolution: session → workspace → global agent config, each gated (t87).
  const resolved = await resolveAgentModel(agentName, context)
  const gatedTarget = gateLayerModel(target?.model, transitionRecents, { layer: "global-declaration", agent: agentName })
  const gatedFallback = gateLayerModel(fallback, transitionRecents, { layer: "last-message", agent: agentName })
  const transitionHead = resolveGlobalHead(transitionRecents, new Map())
  const model = resolved ?? gatedTarget ?? gatedFallback ?? transitionHead ?? fallback
  const sameAsAgentModel = target?.model?.providerID === model.providerID && target?.model?.modelID === model.modelID
  const resolvedVariant = await resolveAgentVariant(agentName, model, context)
  const variant =
    resolvedVariant ??
    (sameAsAgentModel ? target?.variant : undefined) ??
    fallback.variant
  return {
    providerID: ProviderID.make(model.providerID),
    modelID: ModelID.make(model.modelID),
    ...(variant ? { variant } : {}),
  }
}

export const Parameters = Schema.Struct({})

/** Eager conversation-tail so tool-driven transitions match TUI + typed message. */
function attachIdentityTail(session: Session.Interface, msg: MessageV2.User, text: string) {
  return session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: msg.sessionID,
    type: "text",
    text,
    synthetic: true,
  } satisfies MessageV2.TextPart)
}

/** build_mode → plan_mode (permission-gated; default allow — no dialog). */
export const PlanEnterTool = Tool.define(
  "planenter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service

    return {
      description: ENTER_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "planenter",
            patterns: ["*"],
            always: ["*"],
            metadata: { target: "plan_mode" },
          })

          const targetAgent = yield* agents.get("plan_mode")
          const fallbackModel = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())
          const model = yield* Effect.tryPromise({
            try: () =>
              transitionModel(
                "plan_mode",
                targetAgent,
                fallbackModel,
                { sessionID: ctx.sessionID },
              ),
            catch: (e) => e,
          }).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!model) return yield* Effect.fail(new Error("Failed to resolve model for plan_mode"))
          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "plan_mode",
            model,
          }
          yield* session.updateMessage(msg)
          yield* attachIdentityTail(session, msg, PROMPT_PLAN)
          invalidatePermissionCache()

          return {
            title: "Switched to plan_mode",
            output:
              "IDENTITY SWITCH COMPLETE: You are now plan_mode (not build_mode). " +
              "Product source edits are FORBIDDEN. Write plans under plans/ only. " +
              "Earlier build_mode implement-now instructions are SUPERSEDED for this phase.",
            metadata: { identity: "plan_mode", previous: "build_mode" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** plan_mode → build_mode (permission-gated; default allow — no dialog). */
export const PlanExitTool = Tool.define(
  "planexit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(Instance.worktree, Session.plan(info))
          yield* ctx.ask({
            permission: "planexit",
            patterns: ["*"],
            always: ["*"],
            metadata: { target: "build_mode", plan },
          })

          const targetAgent = yield* agents.get("build_mode")
          const fallbackModel = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())
          const model = yield* Effect.tryPromise({
            try: () =>
              transitionModel(
                "build_mode",
                targetAgent,
                fallbackModel,
                { sessionID: ctx.sessionID },
              ),
            catch: (e) => e,
          }).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!model) return yield* Effect.fail(new Error("Failed to resolve model for build_mode"))

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build_mode",
            model,
          }
          yield* session.updateMessage(msg)
          yield* attachIdentityTail(session, msg, PROMPT_BUILD)
          invalidatePermissionCache()

          return {
            title: "Switched to build_mode",
            output: sealUserText(
              "IDENTITY SWITCH COMPLETE: You are now build_mode (not plan_mode). " +
                "Any earlier plan-mode reminder in this session is SUPERSEDED and VOID. " +
                "Do not claim you are still in plan mode. Do not refuse product edits. " +
                "Full tool access. Begin implementing the plan immediately.",
              Date.now(),
            ),
            metadata: { identity: "build_mode", previous: "plan_mode" },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "planexit",
)
