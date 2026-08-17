import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Agent } from "@/agent/agent"
import { type SessionID, MessageID, PartID } from "../session/schema"
import { invalidatePermissionCache } from "./permission-cache"
import PROMPT_BUILD_RAW from "../session/prompt/build.txt"
import PROMPT_REASONING_RAW from "../session/prompt/reasoning-mode.txt"
import {
  loadSessionSettings,
  sessionAgentModel,
  sessionAgentVariant,
  type ModelRef,
  type SessionSettings,
} from "../session/session-settings"

const PROMPT_BUILD = PROMPT_BUILD_RAW.replace(/\r\n/g, "\n")
const PROMPT_REASONING = PROMPT_REASONING_RAW.replace(/\r\n/g, "\n")

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

function transitionModel(
  agentName: string,
  target: Agent.Info | undefined,
  settings: SessionSettings | null,
  fallback: ModelRef & { variant?: string },
) {
  const model = sessionAgentModel(agentName, settings) ?? target?.model ?? fallback
  const sameAsAgentModel = target?.model?.providerID === model.providerID && target?.model?.modelID === model.modelID
  const variant =
    sessionAgentVariant(agentName, model, settings) ??
    (sameAsAgentModel ? target?.variant : undefined) ??
    fallback.variant
  return {
    providerID: ProviderID.make(model.providerID),
    modelID: ModelID.make(model.modelID),
    ...(variant ? { variant } : {}),
  }
}

function requireNativeIdentity(ctx: Tool.Context, identity: "build_mode" | "reasoning_mode") {
  if (ctx.agentInfo?.native && ctx.agentInfo.name === identity)
    return Effect.void
  return Effect.die(new Error(`reasoning transition requires native ${identity}`))
}

export const ReasoningEnterParameters = Schema.Struct({})
export const ReasoningExitParameters = Schema.Struct({})

export const ReasoningEnterTool = Tool.define(
  "reasoningenter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service

    return {
      description:
        "Move a build session into protected reasoning mode. Only native build_mode may enter; reasoning_mode permits getmode, permanent memory, and its own exit.",
      parameters: ReasoningEnterParameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* requireNativeIdentity(ctx, "build_mode")
          const settings = yield* Effect.tryPromise({
            try: () => loadSessionSettings(ctx.sessionID),
            catch: (cause) => cause,
          }).pipe(Effect.catch(() => Effect.succeed(null)))
          const model = transitionModel(
            "reasoning_mode",
            yield* agents.get("reasoning_mode"),
            settings,
            getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel()),
          )

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "reasoning_mode",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: PROMPT_REASONING,
            synthetic: true,
          } satisfies MessageV2.TextPart)
          invalidatePermissionCache()

          return {
            title: "Switched to reasoning_mode",
            output:
              "IDENTITY SWITCH COMPLETE: You are now reasoning_mode. " +
              "Only getmode, permanent memory, and reasoningexit are authorized. Wait for the user calibration question.",
            metadata: { identity: "reasoning_mode" },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "reasoning_enter",
)

export const ReasoningExitTool = Tool.define(
  "reasoningexit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const agents = yield* Agent.Service

    return {
      description:
        "Return a controlled session from protected reasoning mode to build_mode. Only native reasoning_mode may use this transition.",
      parameters: ReasoningExitParameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* requireNativeIdentity(ctx, "reasoning_mode")
          const settings = yield* Effect.tryPromise({
            try: () => loadSessionSettings(ctx.sessionID),
            catch: (cause) => cause,
          }).pipe(Effect.catch(() => Effect.succeed(null)))
          const model = transitionModel(
            "build_mode",
            yield* agents.get("build_mode"),
            settings,
            getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel()),
          )
          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build_mode",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: PROMPT_BUILD,
            synthetic: true,
          } satisfies MessageV2.TextPart)
          invalidatePermissionCache()

          return {
            title: "Switched to build_mode",
            output:
              "IDENTITY SWITCH COMPLETE: You are now build_mode (not reasoning_mode). " +
              "Full tool access restored. Earlier reasoning_mode limits are VOID.",
            metadata: { identity: "build_mode", previous: "reasoning_mode" },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "reasoning_exit",
)
