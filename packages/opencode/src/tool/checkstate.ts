import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionCompaction } from "@/session/compaction"
import { IncrementalCheckpoint } from "@/session/incremental-checkpoint"
import { usable } from "@/session/overflow"
import * as CompactionRequest from "@/session/compaction-request"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

export const Parameters = Schema.Struct({})

type Metadata = {
  mode: string
  agent_mode: Agent.Info["mode"]
  permission_count: number
  version: string
  context?: {
    model: string
    limit: number
    fold_at: number
    open: number
    headroom: number
    turns_left: number | null
    compact_armed: boolean
  }
  summaries: { id: string; from: string; to: string; chars: number }[]
}

export function formatModeSnapshot(
  current: Pick<Agent.Info, "name" | "mode" | "permission" | "subagents">,
  available: string[],
) {
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

/**
 * Average visible tokens added per user turn in the open window.
 *
 * One turn is not a rate: the first turn after a fold carries the folded star
 * and would read as an enormous burn, which would then report a headroom of
 * zero turns and provoke a pointless fold. Two is the smallest honest sample.
 */
export function burnRate(open: number, userTurns: number): number | null {
  if (userTurns < 2 || open <= 0) return null
  return open / userTurns
}

/**
 * A person knows when they are about to run out; an agent has no such sense.
 * Without these numbers the only compaction trigger it can act on is the
 * runtime's ceiling — which fires wherever it lands, including the middle of a
 * delicate edit. @COMPACTION_CADENCE asks for a chosen boundary instead, and a
 * boundary can only be chosen by someone who can see how far away the wall is.
 */
export function formatWindow(input: {
  model: string
  limit: number
  foldAt: number
  open: number
  perTurn: number | null
  armed: boolean
  auto: boolean
}) {
  const headroom = Math.max(0, input.foldAt - input.open)
  const pct = input.foldAt > 0 ? Math.round((input.open / input.foldAt) * 100) : 0
  const turns = input.perTurn && input.perTurn > 0 ? Math.floor(headroom / input.perTurn) : null
  return [
    `Model: ${input.model}`,
    `Context window: ${input.limit.toLocaleString("en-US")} tokens`,
    `Auto-fold at: ${input.foldAt.toLocaleString("en-US")} tokens of visible content`,
    `Open window now: ${input.open.toLocaleString("en-US")} tokens (${pct}% of the fold threshold)`,
    turns === null
      ? `Headroom: ${headroom.toLocaleString("en-US")} tokens (burn rate unknown — too few turns since the last fold)`
      : `Headroom: ${headroom.toLocaleString("en-US")} tokens ~ ${turns} more turn${turns === 1 ? "" : "s"} at the recent ${Math.round(input.perTurn ?? 0).toLocaleString("en-US")}/turn`,
    `Boundary fold armed this turn: ${input.armed ? "yes" : "no"}`,
    input.auto
      ? "Automatic fold: ON. It fires on window fill, wherever that lands — including mid-edit. Call `compact` at a boundary you choose instead."
      : "Automatic fold: OFF (compaction.auto=false). Nothing folds unless you call `compact`.",
  ].join("\n")
}

/**
 * The open Layer-1 summaries — exactly what the next fold will pack into `m*`.
 *
 * Their bodies are Inferred prose and stay editable right up to the fold; their
 * `from_id`/`to_id` links are Exact and are not. Listing the ids here is what
 * makes "put your affairs in order before compacting" actionable: without them
 * an identity can read summaries via `sessionread` but cannot tell which ones
 * are still open, so it does not know what it is about to carry forward.
 */
export function formatSummaries(
  open: { id: string; fromMessageID: string; toMessageID: string; body: string }[],
) {
  if (open.length === 0) return "Open summaries: none — the next fold would carry the recent tail only."
  return [
    `Open summaries (${open.length}) — these fold into the next m*. Bodies are Inferred and editable until then; from/to links are Exact.`,
    ...open.map((s) => {
      const label = (s.body.split("\n").find((line) => line.trim().length > 0) ?? "").trim().slice(0, 70)
      return `- \`${s.id}\`  ${s.fromMessageID}..${s.toMessageID}  ${s.body.length.toLocaleString("en-US")} chars  ${label}`
    }),
  ].join("\n")
}

export const CheckStateTool = Tool.define<
  typeof Parameters,
  Metadata,
  Agent.Service | Session.Service | Provider.Service | Config.Service
>(
  "checkstate",
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const session = yield* Session.Service
    const provider = yield* Provider.Service
    const config = yield* Config.Service

    return {
      description:
        "Return the current identity, its complete ordered execute-time permission rules, delegable agents, " +
        "available agents, the runtime version, and this session's context-window state: where the automatic " +
        "fold threshold sits, how much headroom is left, roughly how many turns that is at the recent rate, " +
        "and whether a boundary fold is already armed. Tool schemas are always the full shared catalog. " +
        "Call it when the active mode or permission outcome is uncertain, and before deciding whether to " +
        "close a task and `compact`.",
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

          const identity = formatModeSnapshot(
            {
              ...currentInfo,
              permission: Permission.merge(currentSession.permission ?? [], currentInfo.permission),
            },
            available,
          )

          // Best effort: a session with no user message yet, or a model the
          // provider cannot resolve, still gets the identity block. A missing
          // gauge is reported as missing — never as a comfortable zero.
          const window = yield* Effect.gen(function* () {
            const visible = yield* MessageV2.filterCompactedEffect(ctx.sessionID)
            const lastUser = visible.findLast((m) => m.info.role === "user")
            if (!lastUser || lastUser.info.role !== "user") return null
            const model = yield* provider.getModel(lastUser.info.model.providerID, lastUser.info.model.modelID)
            const cfg = yield* config.get()
            const open = SessionCompaction.computeOpenWindowTokens(visible, undefined, model)
            return {
              model: `${model.providerID}/${model.id}`,
              limit: model.limit.context,
              foldAt: usable({ cfg, model }),
              open,
              // Layer-1 cadence is measured from the newest sidecar boundary,
              // Layer-2 from the whole visible window. Reporting the Layer-2
              // number is the one the fold threshold is actually compared to.
              sinceSummary: SessionCompaction.computeOpenWindowTokens(
                visible,
                IncrementalCheckpoint.latestOpen(ctx.sessionID)?.toMessageID,
                model,
              ),
              perTurn: burnRate(open, visible.filter((m) => m.info.role === "user").length),
              armed: CompactionRequest.pendingFor(ctx.sessionID),
              auto: cfg.compaction?.auto !== false,
            }
          }).pipe(Effect.catch(() => Effect.succeed(null)))

          const headroom = window ? Math.max(0, window.foldAt - window.open) : 0
          const open = IncrementalCheckpoint.listOpen(ctx.sessionID)

          return {
            title: `State: ${currentAgent}`,
            output: [
              identity,
              "",
              `Runtime: opencode ${InstallationVersion}`,
              "",
              window
                ? formatWindow(window)
                : "Context window: unavailable (no user message in this session yet, or the model could not be resolved).",
              "",
              formatSummaries(open),
            ].join("\n"),
            metadata: {
              mode: currentAgent,
              agent_mode: currentInfo.mode,
              permission_count: (currentSession.permission ?? []).length + currentInfo.permission.length,
              version: InstallationVersion,
              ...(window && {
                context: {
                  model: window.model,
                  limit: window.limit,
                  fold_at: window.foldAt,
                  open: window.open,
                  headroom,
                  turns_left: window.perTurn ? Math.floor(headroom / window.perTurn) : null,
                  compact_armed: window.armed,
                },
              }),
              summaries: open.map((s) => ({
                id: s.id,
                from: s.fromMessageID,
                to: s.toMessageID,
                chars: s.body.length,
              })),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
  "check_state",
)
