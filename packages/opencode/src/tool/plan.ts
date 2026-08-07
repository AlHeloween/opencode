import path from "path"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { MessageV2 } from "../session/message-v2"
import { Provider } from "@/provider/provider"
import { Instance } from "../project/instance"
import { type SessionID, MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./planexit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"
import { invalidatePermissionCache } from "./permission-cache"
import PROMPT_BUILD_RAW from "../session/prompt/build.txt"
import PROMPT_PLAN_RAW from "../session/prompt/plan.txt"

// Same CRLF normalize as prompt.ts — hasSynthetic must match byte-for-byte.
const PROMPT_BUILD = PROMPT_BUILD_RAW.replace(/\r\n/g, "\n")
const PROMPT_PLAN = PROMPT_PLAN_RAW.replace(/\r\n/g, "\n")

function getLastModel(sessionID: SessionID) {
  for (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return undefined
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

/** build_mode → plan_mode (user approval). */
export const PlanEnterTool = Tool.define(
  "planenter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: ENTER_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question:
                  "This looks like it would benefit from planning first. Switch to plan_mode?",
                header: "plan_mode",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to plan_mode — plans/ only, no product edits" },
                  { label: "No", description: "Stay in build_mode and implement now" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") return yield* new Question.RejectedError()

          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())
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
  "plan_enter",
)

/** plan_mode → build_mode (user approval). */
export const PlanExitTool = Tool.define(
  "planexit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const info = yield* session.get(ctx.sessionID)
          const plan = path.relative(Instance.worktree, Session.plan(info))
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: [
              {
                question: `Plan at ${plan} is complete. Would you like to switch to build_mode and start implementing?`,
                header: "build_mode",
                custom: false,
                options: [
                  { label: "Yes", description: "Switch to build_mode and start implementing the plan" },
                  { label: "No", description: "Stay in plan_mode to continue refining the plan" },
                ],
              },
            ],
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          if (answers[0]?.[0] === "No") return yield* new Question.RejectedError()

          const model = getLastModel(ctx.sessionID) ?? (yield* provider.defaultModel())

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
            output:
              "IDENTITY SWITCH COMPLETE: You are now build_mode (not plan_mode). " +
              "Any earlier plan-mode reminder in this session is SUPERSEDED and VOID. " +
              "Do not claim you are still in plan mode. Do not refuse product edits. " +
              "Full tool access. Begin implementing the plan immediately.",
            metadata: { identity: "build_mode", previous: "plan_mode" },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "plan_exit",
)
