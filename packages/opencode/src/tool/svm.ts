/**
 * The task manifest as a tool — `svm read|set|render`.
 *
 * Kernel §1.4 SVM, seen from the plan side (owner, 2026-09-29): a task carries its semantic VECTOR, a
 * REF to its plan, and the approximate number of TURNS until that plan moves to `plans_completed/` —
 * plus the state it is in and the oracle that would prove it done.
 *
 * The store is `session/svm.ts` over the keyed `Storage` plane. This file is only the surface:
 * `read` one task's manifest, `set` one, or `render` the map of all of them into `plans/MASTER_PLAN.md`.
 *
 * The store is captured at init, not looked up inside `execute`: a tool's execute effect may carry no
 * service requirement (`Def.execute` is typed `R = never`), and a service fetched inside it would
 * simply not typecheck. `Agent.Service` and `Truncate.Service` are closed over by `Tool.define` the
 * same way. The WORKTREE is read the same service-free way (`Instance.worktree`), which is also how
 * `tool/memory.ts` reaches its file.
 */
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Storage } from "@/storage/storage"
import * as SVM from "@/session/svm"
import { Instance } from "@/project/instance"

const Parameters = Schema.Struct({
  action: Schema.Literals(["read", "set", "render"]),
  plan: Schema.optional(Schema.String).annotate({
    description:
      "read/set only, and REQUIRED there: the plan file this task belongs to, as written in the repo, e.g. plans/2026-09-29_x.md",
  }),
  task: Schema.optional(Schema.String).annotate({
    description: "read/set only, and REQUIRED there: task id as it appears in the plan file, e.g. S3",
  }),
  sv: Schema.optional(Schema.String).annotate({
    description:
      "set only, and REQUIRED there: the task's @SV_FORMAT block — Keywords, semantic dominant, md5 chain.",
  }),
  etaTurns: Schema.optional(Schema.Number).annotate({
    description: "set only, and REQUIRED there: approximate turns until this plan moves to plans_completed/.",
  }),
  oracle: Schema.optional(Schema.String).annotate({
    description: "set only, and REQUIRED there: what will PROVE the task — the instrument, not the hope.",
  }),
  state: Schema.optional(Schema.Literals(["doing", "blocked", "verified", "waiting-on-user"])).annotate({
    description: "set only: where the task stands. Defaults to doing.",
  }),
})

type Metadata = {
  plan?: string
  task?: string
  action: string
  present: boolean
  /** Where the record's plan ref stands (`SVM.resolvePlan`) — `present` when it resolves. */
  planRef?: "present" | "moved" | "deleted"
}

export const SvmTool = Tool.define<typeof Parameters, Metadata, Storage.Service>(
  "svm",
  Effect.gen(function* () {
    const storage = yield* Storage.Service

    return {
      description:
        "The manifest (SVM, kernel §1.4) of a task. action='read' returns the stored manifest, or says plainly " +
        "that the task has none — nothing is invented. action='set' writes one and REQUIRES sv, etaTurns and " +
        "oracle: a manifest without its vector is the hole this store exists to close, so a partial one is " +
        "refused rather than stored. action='render' regenerates the generated BODY of " +
        "`plans/MASTER_PLAN.md` from the plan files and this store — every vector READ from its source, a " +
        "missing one printed as MISSING — and preserves the hand-owned head above the render marker, " +
        "including the goal, which it must never invent.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          if (params.action === "render") {
            // The whole operation lives in the session layer (`applyRender`): one write path, so a probe that
            // smokes the renderer against the real repository exercises the SAME code this verb runs.
            const result = yield* SVM.applyRender(Instance.worktree)
            if (!result.ok) {
              return {
                title: "svm: render refused",
                output: `Refused: ${result.reason}`,
                metadata: { action: "render", present: false },
              }
            }
            return {
              title: `svm: render — ${result.stats.plans} plan(s), ${result.stats.openBoxes} open box(es), ${result.stats.missingTaskSv + result.stats.missingPlanSv} vector(s) MISSING`,
              output: JSON.stringify({ file: result.file, bytes: result.bytes, ...result.stats }, null, 2),
              metadata: { action: "render", present: true },
            }
          }

          if (!params.plan || !params.task) {
            return {
              title: `svm: ${params.action} refused — plan and task are required`,
              output:
                `Refused: action="${params.action}" addresses ONE task, so it needs both \`plan\` and \`task\`. ` +
                `\`render\` is the action that addresses every task at once.`,
              metadata: { action: params.action, present: false },
            }
          }

          if (params.action === "read") {
            const record = yield* SVM.read(storage, params.plan, params.task)
            if (!record) {
              return {
                title: `svm: no manifest for ${params.task}`,
                output:
                  `No manifest for task ${params.task} in ${params.plan}. It has never been given one, and ` +
                  `nothing is invented here. Write one with action="set" (sv, etaTurns and oracle required).`,
                metadata: { plan: params.plan, task: params.task, action: "read", present: false },
              }
            }
            // THE PLAN-REF INVARIANT (plan S5): a record whose plan file is gone is REPORTED, never
            // handed over as if its direction were live. The store has no `remove` — a record outliving
            // its plan is the design, not an accident — so the reader is the one place it can say what
            // the record has become.
            //
            // The finding rides the TITLE and the METADATA, never `output`: that payload is the record
            // as DATA, and prose appended to it would make this tool unparseable to every machine
            // reader — its own test included, which parses it.
            const ref = SVM.resolvePlan(Instance.worktree, record.plan)
            return {
              title:
                ref === "present"
                  ? `svm: ${record.task} · ${record.state} · eta ${record.etaTurns}`
                  : `svm: ${record.task} · ${record.state} · eta ${record.etaTurns} · PLAN REF GONE (${ref}) — ${record.plan} is not on disk, so this record outlived its plan and is a trace, not a task in flight`,
              output: JSON.stringify(record, null, 2),
              metadata: { plan: record.plan, task: record.task, action: "read", present: true, planRef: ref },
            }
          }

          if (!params.sv || params.etaTurns === undefined || !params.oracle) {
            const absent = [
              !params.sv ? "sv" : undefined,
              params.etaTurns === undefined ? "etaTurns" : undefined,
              !params.oracle ? "oracle" : undefined,
            ].filter((name): name is string => name !== undefined)
            return {
              title: `svm: set refused — ${absent.join(", ")} missing`,
              output:
                `Refused: ${absent.join(", ")} must be given. A manifest without its vector, its distance to ` +
                `done, or its oracle is not a manifest — it would read as present while carrying nothing, ` +
                `which is the hole this store exists to close.`,
              metadata: { plan: params.plan, task: params.task, action: "set", present: false },
            }
          }

          const record: SVM.SVMRecord = {
            task: params.task,
            plan: params.plan,
            sv: params.sv,
            etaTurns: params.etaTurns,
            state: params.state ?? "doing",
            oracle: params.oracle,
          }
          yield* SVM.write(storage, params.plan, record)
          return {
            title: `svm: ${record.task} stored · ${record.state} · eta ${record.etaTurns}`,
            output: JSON.stringify(record, null, 2),
            metadata: { plan: record.plan, task: record.task, action: "set", present: true },
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
