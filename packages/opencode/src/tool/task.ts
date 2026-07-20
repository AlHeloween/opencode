import * as Tool from "./tool"
import DESCRIPTION from "./task.txt"
import { Session } from "@/session/session"
import { SessionID, MessageID, PartID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import type { SessionPrompt } from "../session/prompt"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Checkpoint } from "../session/checkpoint"
import { Effect, Exit, Option, Schema } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Provider } from "@/provider/provider"
import { ProviderID } from "@/provider/schema"
import { Jobs } from "../jobs"

const log = Log.create({ service: "task" })

/** Finalize an unfinished assistant message left behind by a failed/hung sub-agent. */
function finalizeOrphanAssistant(
  sessions: Session.Interface,
  sessionID: SessionID,
  providerID: string,
  error: unknown,
) {
  return Effect.gen(function* () {
    const match = yield* sessions.findMessage(
      sessionID,
      (m) => m.info.role === "assistant" && !m.info.finish,
    )
    if (Option.isNone(match)) return
    const msg = match.value
    if (msg.info.role !== "assistant") return
    const assistant = msg.info
    assistant.error = MessageV2.fromError(error, {
      providerID: ProviderID.make(providerID),
      aborted: error instanceof DOMException && error.name === "AbortError",
    })
    assistant.finish = "error"
    assistant.time.completed = Date.now()
    yield* sessions.updateMessage(assistant)

    // Ensure there is at least one text part so the TUI shows the failure.
    const hasText = msg.parts.some((p) => p.type === "text")
    if (!hasText) {
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID,
        type: "text",
        text: `Sub-agent failed: ${error instanceof Error ? error.message : String(error)}`,
        time: { start: Date.now(), end: Date.now() },
      } satisfies MessageV2.TextPart)
    }
    log.warn("finalized orphan assistant", {
      sessionID,
      messageID: assistant.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }).pipe(Effect.catch((e) => Effect.sync(() => log.warn("bug: finalize orphan assistant failed", { error: String(e) }))))
}

export interface TaskPromptOps {
  cancel(sessionID: SessionID): Effect.Effect<void>
  resolvePromptParts(template: string): Effect.Effect<SessionPrompt.PromptInput["parts"]>
  prompt(input: SessionPrompt.PromptInput): Effect.Effect<MessageV2.WithParts>
}

const id = "task"
let taskCacheLeaseID = 0
const taskCacheLeases = new Map<string, number>()

type Metadata = {
  sessionId: SessionID
  model: { providerID: string; modelID: string }
}

function acquireTaskCacheLease(input: {
  parentSessionID: SessionID
  agent: string
  providerID: string
  modelID: string
}) {
  const scope = [input.parentSessionID, input.agent, input.providerID, input.modelID].join(":")
  const slot = (() => {
    for (let i = 1; ; i++) {
      const candidate = `task-${i}`
      if (!taskCacheLeases.has(`${scope}:${candidate}`)) return candidate
    }
  })()
  const cacheKey = `${scope}:${slot}`
  const token = ++taskCacheLeaseID
  taskCacheLeases.set(cacheKey, token)
  return {
    cacheKey,
    slot,
    release: Effect.sync(() => {
      if (taskCacheLeases.get(cacheKey) === token) taskCacheLeases.delete(cacheKey)
    }),
  }
}

export const Parameters = Schema.Struct({
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task" }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform" }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task" }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "This should only be set if you mean to resume a previous task (you can pass a prior task_id and the task will continue the same subagent session as before instead of creating a fresh one)",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "The command that triggered this task" }),
  run_in_background: Schema.optional(Schema.Boolean).annotate({
    description: "If true, run the sub-agent as a background job and return immediately with a job ID. Use job_output to read the result.",
  }),
})

export const TaskTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const appFs = yield* AppFileSystem.Service
    const provider = yield* Provider.Service

    const run = Effect.fn("TaskTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()

      if (!ctx.extra?.bypassAgentCheck) {
        yield* ctx.ask({
          permission: id,
          patterns: [params.subagent_type],
          always: ["*"],
          metadata: {
            description: params.description,
            subagent_type: params.subagent_type,
          },
        })
      }

      const next = yield* agent.get(params.subagent_type)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      // Enforce subagent delegation restrictions: calling agent's subagents list limits which types it can spawn
      const caller = yield* agent.get(ctx.agent)
      if (caller?.subagents && !caller.subagents.includes(params.subagent_type)) {
        return yield* Effect.fail(
          new Error(`Agent "${ctx.agent}" cannot delegate to "${params.subagent_type}". Allowed: ${caller.subagents.join(", ")}`),
        )
      }

      const canTask = next.permission.some((rule) => rule.permission === id)
      const canTodo = next.permission.some((rule) => rule.permission === "todowrite")

      const taskID = params.task_id
      const session = taskID
        ? yield* sessions.get(SessionID.make(taskID)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const nextSession =
        session ??
        (yield* sessions.create({
          parentID: ctx.sessionID,
          title: params.description + ` (@${next.name} subagent)`,
          permission: [
            ...(canTodo
              ? []
              : [
                  {
                    permission: "todowrite" as const,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(canTask
              ? []
              : [
                  {
                    permission: id,
                    pattern: "*" as const,
                    action: "deny" as const,
                  },
                ]),
            ...(cfg.experimental?.primary_tools?.map((item) => ({
              pattern: "*",
              action: "allow" as const,
              permission: item,
            })) ?? []),
          ],
        }))

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      // First determine the model
      const taskModelOverride = yield* appFs.readJson(path.join(Global.Path.state, "model.json")).pipe(
        Effect.map((x: any) => {
          if (x?.taskModel?.providerID && x?.taskModel?.modelID)
            return {
              providerID: x.taskModel.providerID,
              modelID: x.taskModel.modelID,
            }
          return undefined
        }),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const model = taskModelOverride ?? next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      // Now read agent-specific variant for this model
      const taskVariant = yield* appFs.readJson(path.join(Global.Path.state, "model.json")).pipe(
        Effect.map((x: any) => {
          if (!next?.name) return undefined
          const modelKey = `${model.providerID}/${model.modelID}`
          const agentKey = `${next.name}/${modelKey}`
          // Check agent-specific variant first, then fall back to model-level variant
          if (x?.agentVariant?.[agentKey]) return x.agentVariant[agentKey]
          if (x?.variant?.[modelKey]) return x.variant[modelKey]
          return undefined
        }),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      // Diagnostic: log when task agent model has different context window than parent
      const parentModel = { modelID: msg.info.modelID, providerID: msg.info.providerID }
      if (parentModel.modelID !== model.modelID || parentModel.providerID !== model.providerID) {
        const logCtx = Log.create({ service: "task" })
        const taskResolved = yield* provider.getModel(model.providerID, model.modelID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        const parentResolved = yield* provider.getModel(parentModel.providerID, parentModel.modelID).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (taskResolved && parentResolved) {
          logCtx.info("task agent model differs from parent", {
            parentModel: `${parentModel.providerID}/${parentModel.modelID}`,
            parentContext: parentResolved.limit?.context,
            taskModel: `${model.providerID}/${model.modelID}`,
            taskContext: taskResolved.limit?.context,
            subagent: next.name,
          })
        }
      }

      // Clone checkpoint from previous same-agent session for KV cache continuity
      if (!session) {
        const ins = yield* InstanceState.context
        const sourceSid = yield* Checkpoint.findLatest({
          providerID: model.providerID,
          modelID: model.modelID,
          agentName: next.name,
          excludeSessionID: nextSession.id,
        })
        if (sourceSid) {
          yield* Checkpoint.clone({
            sourceSessionID: sourceSid,
            destSessionID: nextSession.id,
            providerID: model.providerID,
            modelID: model.modelID,
            agentName: next.name,
            projectID: ins.project.id,
          })
        }
      }

      yield* ctx.metadata({
        title: params.description,
        metadata: {
          sessionId: nextSession.id,
          model,
        },
      })

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("TaskTool requires promptOps in ctx.extra"))

      const cacheLease = session
        ? undefined
        : acquireTaskCacheLease({
            parentSessionID: ctx.sessionID,
            agent: next.name,
            providerID: model.providerID,
            modelID: model.modelID,
          })

      // Background execution: fork the task via Jobs.Service and return immediately
      if (params.run_in_background) {
        const jobSvc = yield* Effect.serviceOption(Jobs.Service)
        if (jobSvc._tag === "None") {
          // Fallback to synchronous if Jobs not available
        } else {
          const jobID = yield* jobSvc.value.startEffect({
            sessionID: ctx.sessionID,
            kind: "task",
            label: params.description,
            run: (_writeOutput) => {
              return Effect.gen(function* () {
                const messageID = MessageID.ascending()
                const parts = yield* ops.resolvePromptParts(params.prompt)
                const result = yield* ops
                  .prompt({
                    messageID,
                    sessionID: nextSession.id,
                    providerCacheKey: cacheLease?.cacheKey,
                    model: {
                      modelID: model.modelID,
                      providerID: model.providerID,
                    },
                    agent: next.name,
                    variant: taskVariant,
                    tools: {
                      ...(canTodo ? {} : { todowrite: false }),
                      ...(canTask ? {} : { task: false }),
                      ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                    },
                    parts,
                  })
                  .pipe(
                    Effect.timeout(300_000),
                    Effect.catch((error) =>
                      Effect.gen(function* () {
                        yield* ops.cancel(nextSession.id)
                        yield* finalizeOrphanAssistant(sessions, nextSession.id, model.providerID, error)
                        return {
                          parts: [
                            {
                              type: "text" as const,
                              text: `Sub-agent '${next.name}' failed: ${error instanceof Error ? error.message : String(error)}`,
                            },
                          ],
                        } satisfies { parts: { type: "text"; text: string }[] }
                      }),
                    ),
                  )
                return result.parts.findLast((item) => item.type === "text")?.text ?? ""
              }).pipe(Effect.ensuring(cacheLease?.release ?? Effect.void))
            },
          }).pipe(Effect.tapError(() => cacheLease?.release ?? Effect.void))
          return {
            title: params.description,
            metadata: {
              sessionId: nextSession.id,
              model,
            },
            output: `Task spawned as background job ${jobID}. Use job_output(${jobID}) to read the result when ready, or job_wait to block until completion.`,
          }
        }
      }

      // Synchronous execution — original path
      const messageID = MessageID.ascending()

      const runCancel = yield* EffectBridge.make()
      const cancel = ops.cancel(nextSession.id)

      function onAbort() {
        runCancel.fork(cancel)
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const parts = yield* ops.resolvePromptParts(params.prompt)
            const result = yield* ops
              .prompt({
                messageID,
                sessionID: nextSession.id,
                providerCacheKey: cacheLease?.cacheKey,
                model: {
                  modelID: model.modelID,
                  providerID: model.providerID,
                },
                agent: next.name,
                tools: {
                  ...(canTodo ? {} : { todowrite: false }),
                  ...(canTask ? {} : { task: false }),
                  ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
                },
                parts,
              })
              .pipe(
                Effect.timeout(300_000),
                Effect.catch((error) =>
                  Effect.gen(function* () {
                    yield* cancel
                    yield* finalizeOrphanAssistant(sessions, nextSession.id, model.providerID, error)
                    return {
                      parts: [
                        {
                          type: "text" as const,
                          text: `Sub-agent '${next.name}' failed: ${error instanceof Error ? error.message : String(error)}`,
                        },
                      ],
                    } satisfies { parts: { type: "text"; text: string }[] }
                  }),
                ),
              )

            return {
              title: params.description,
              metadata: {
                sessionId: nextSession.id,
                model,
              },
              output: [
                `task_id: ${nextSession.id} (for resuming to continue this task if needed)`,
                "",
                "<task_result>",
                result.parts.findLast((item) => item.type === "text")?.text ?? "",
                "</task_result>",
              ].join("\n"),
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) {
              yield* cancel
              yield* finalizeOrphanAssistant(
                sessions,
                nextSession.id,
                model.providerID,
                new DOMException("Aborted", "AbortError"),
              )
            }
            if (cacheLease) yield* cacheLease.release
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
        run(params, ctx).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              title: params.description,
              metadata: { sessionId: SessionID.make("(failed)"), model: { providerID: "", modelID: "" } },
              output: [
                `task_id: (failed)`,
                ``,
                `<task_result>`,
                `Sub-agent '${params.subagent_type}' failed: ${error instanceof Error ? error.message : String(error)}`,
                `</task_result>`,
              ].join("\n"),
            }),
          ),
        ),
    }
  }),
)
