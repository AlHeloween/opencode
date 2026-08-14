import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Session } from "@/session/session"

export const Parameters = Schema.Struct({})

type Metadata = {
  mode: string
  agent_mode: Agent.Info["mode"]
  permission_count: number
}

export function formatModeSnapshot(current: Pick<Agent.Info, "name" | "mode" | "permission" | "subagents">, available: string[]) {
  const delegable = current.subagents?.length ? current.subagents.join(", ") : "all configured agents"
  const rules = current.permission.length
    ? current.permission.map((rule, index) => `- ${index + 1}. ${rule.permission} ${rule.pattern} → ${rule.action}`)
    : ["- (no explicit rules)"]

  return [
    `Current identity: ${current.name}`,
    `Identity type: ${current.mode}`,
    `Delegable agents: ${delegable}`,
    `Available agents: ${available.join(", ")}`,
    "Effective permission rules (ordered; the executor evaluates the matching rule for the actual action and target):",
    ...rules,
  ].join("\n")
}

export const GetModeTool = Tool.define<
  typeof Parameters,
  Metadata,
  Agent.Service | Session.Service
>(
  "getmode",
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const session = yield* Session.Service

    return {
      description:
        "Return the current identity, its complete ordered execute-time permission rules, " +
        "delegable agents, and available agents. Tool schemas are always the full shared catalog; " +
        "call this before an action when the active mode or permission outcome is uncertain.",
      parameters: Parameters,
      execute: (_params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const currentAgent = ctx.agentInfo?.name ?? "unknown"
          const currentInfo = ctx.agentInfo ?? { name: currentAgent, mode: "all" as const, permission: [] }
          const currentSession = yield* session.get(ctx.sessionID)
          const list = yield* agent.list()
          const available = list
            .filter((a: Agent.Info) => !a.hidden)
            .map((a: Agent.Info) => a.name)
            .sort()

          return {
            title: `Mode: ${currentAgent}`,
            output: formatModeSnapshot(
              {
                ...currentInfo,
                permission: Permission.merge(currentSession.permission ?? [], currentInfo.permission),
              },
              available,
            ),
            metadata: {
              mode: currentAgent,
              agent_mode: currentInfo.mode,
              permission_count: (currentSession.permission ?? []).length + currentInfo.permission.length,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "get_mode",
)
