import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"

export const Parameters = Schema.Struct({})

type Metadata = { mode: string }

export const GetModeTool = Tool.define<
  typeof Parameters,
  Metadata,
  Agent.Service
>(
  "getmode",
  Effect.gen(function* () {
    const agent = yield* Agent.Service

    return {
      description:
        "Return the current agent mode (build_mode, plan_mode, reasoning_mode) " +
        "and the list of available agents. Tools are listed separately — use " +
        "the tool descriptions in each function call for the current tool set.",
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const currentAgent = ctx.agentInfo?.name ?? "unknown"
          const list = yield* agent.list()
          const available = list
            .filter((a: Agent.Info) => !a.hidden)
            .map((a: Agent.Info) => a.name)
            .sort()

          return {
            title: `Mode: ${currentAgent}`,
            output: [
              `Current mode: ${currentAgent}`,
              `Available agents: ${available.join(", ")}`,
            ].join("\n"),
            metadata: {
              mode: currentAgent,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "get_mode",
)
