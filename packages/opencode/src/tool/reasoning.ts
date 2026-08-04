import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { type SessionID, MessageID } from "../session/schema"
import { invalidatePermissionCache } from "./permission-cache"

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

function requireNativeOrchestrator(ctx: Tool.Context) {
  if (ctx.agentInfo?.native && ctx.agentInfo.name === "orchestrator") return Effect.void
  return Effect.die(new Error("reasoning transitions require the native orchestrator"))
}

export const ReasoningEnterParameters = Schema.Struct({})
export const ReasoningExitParameters = Schema.Struct({})

export const ReasoningEnterTool = Tool.define(
  "reasoningenter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service

    return {
      description:
        "Move a controlled session into protected reasoning mode. Only the native Orchestrator may use this transition; Reasoning Mode has only the project memory tool.",
      parameters: ReasoningEnterParameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* requireNativeOrchestrator(ctx)
          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "reasoning",
            model,
          }
          yield* session.updateMessage(msg)
          invalidatePermissionCache()

          return {
            title: "Switching to reasoning mode",
            output: "Entered reasoning mode. Wait for user question.",
            metadata: {},
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

    return {
      description:
        "Return a controlled session from protected reasoning mode to build mode. Only the native Orchestrator may use this transition.",
      parameters: ReasoningExitParameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* requireNativeOrchestrator(ctx)
          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())
          yield* session.updateMessage({
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          } satisfies MessageV2.User)
          invalidatePermissionCache()

          return {
            title: "Switching to build mode",
            output: "Exited reasoning mode. Full tool access restored.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
  "reasoning_exit",
)
