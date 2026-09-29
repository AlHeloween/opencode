/**
 * The task manifest as a tool — `svm read|set`.
 *
 * Kernel §1.4 SVM, seen from the plan side (owner, 2026-09-29): a task carries its semantic VECTOR, a
 * REF to its plan, and the approximate number of TURNS until that plan moves to `plans_completed/` —
 * plus the state it is in and the oracle that would prove it done.
 *
 * The store is `session/svm.ts` over the keyed `Storage` plane. This file is only the surface: read
 * one task's manifest, or write one. `render` — the master plan that carries ALL of them — is a
 * separate task (S4 of the plan), because its derivation walks every plan file rather than one key,
 * and a verb that is advertised before it exists is a lie the model will act on.
 *
 * The store is captured at init, not looked up inside `execute`: a tool's execute effect may carry no
 * service requirement (`Def.execute` is typed `R = never`), and a service fetched inside it would
 * simply not typecheck. `Agent.Service` and `Truncate.Service` are closed over by `Tool.define` the
 * same way.
 */
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Storage } from "@/storage/storage"
import * as SVM from "@/session/svm"

const Parameters = Schema.Struct({
  action: Schema.Literals(["read", "set"]),
  plan: Schema.String.annotate({
    description: "The plan file this task belongs to, as written in the repo, e.g. plans/2026-09-29_x.md",
  }),
  task: Schema.String.annotate({ description: "Task id as it appears in the plan file, e.g. S3" }),
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

type Metadata = { plan: string; task: string; action: string; present: boolean }

export const SvmTool = Tool.define<typeof Parameters, Metadata, Storage.Service>(
  "svm",
  Effect.gen(function* () {
    const storage = yield* Storage.Service

    return {
      description:
        "Read or write the manifest (SVM, kernel §1.4) of ONE task: its semantic vector, its plan ref, and " +
        "the approximate number of turns until that plan moves to plans_completed/, plus its state and the " +
        "oracle that would prove it. action='read' returns the stored manifest, or says plainly that the task " +
        "has none — nothing is invented. action='set' writes one and REQUIRES sv, etaTurns and oracle: a " +
        "manifest without its vector is the hole this store exists to close, so a partial one is refused " +
        "rather than stored.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
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
            return {
              title: `svm: ${record.task} · ${record.state} · eta ${record.etaTurns}`,
              output: JSON.stringify(record, null, 2),
              metadata: { plan: record.plan, task: record.task, action: "read", present: true },
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
