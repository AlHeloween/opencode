import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { type SessionID, MessageID, PartID } from "../session/schema"

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
}

export const ReasoningEnterParameters = Schema.Struct({})
export const ReasoningExitParameters = Schema.Struct({})

export const ReasoningEnterTool = Tool.define(
  "reasoning_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description:
        "Switch from build mode to reasoning mode (memory-only, zero tools). Use when the user asks a question that can be answered from your existing knowledge without consulting files, code, or logs.",
      parameters: ReasoningEnterParameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: "Switch to reasoning mode? You will lose access to all tools — memory-only responses.",
                header: "Reasoning Mode",
                custom: false,
                options: [
                  { label: "Yes", description: "Enter reasoning mode (memory-only, zero tools)" },
                  { label: "No", description: "Stay in build mode with full tool access" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") yield* new Question.RejectedError()

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
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: "Entering reasoning mode. Answer from memory only — no tools available.",
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Switching to reasoning mode",
            output: "Entered reasoning mode. Wait for user question.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)

export const ReasoningExitTool = Tool.define(
  "reasoning_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const provider = yield* Provider.Service

    return {
      description:
        "Exit reasoning mode and return to build mode with full tool access. Use when the user asks you to do something that requires tools (reading files, searching code, running commands, editing).",
      parameters: ReasoningExitParameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())

          const msg: MessageV2.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          }
          yield* session.updateMessage(msg)
          yield* session.updatePart({
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: ctx.sessionID,
            type: "text",
            text: "Returning to build mode with full tool access. Execute the user's request.",
            synthetic: true,
          } satisfies MessageV2.TextPart)

          return {
            title: "Switching to build mode",
            output: "Exited reasoning mode. Full tool access restored.",
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
