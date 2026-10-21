import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { formatPlanHygiene, getPlanStatus, isPlanLinked, parsePlanFiles, planDebt, reconcilePlans } from "@/util/plan-status"

/**
 * THE TICK REPORT AS A TOOL (owner, 2026-09-22): «у нас в оркестраторе есть подсчёт галок — сделай тулзу,
 * чтобы получить этот отчёт, для того чтобы держать репозиторий правильно… надо просто сделать пометку
 * в документации и поставить галку с объяснением».
 *
 * WHY it is a tool and not a chore: the counts existed, but only inside the orchestrator's firmware and
 * inside `plan-status.ts` — so keeping the repository honest required a session that happened to run the
 * right internal path. An instrument the agent can CALL is what turns "the numbers exist" into "the
 * numbers are read": the debt line in `<compaction-status>` says how much is owed, this says WHERE it
 * sits and which plans are in the wrong terminal.
 *
 * It REPORTS and does not decide. `reconcile` is off by default; when it is on it does exactly what the
 * project's own reconciler does — finished plans to `plans_completed/`, kernel-authored ones with open
 * boxes back to `plans/`. The other three terminals (`plans_deferred/`, `plans/futures/`,
 * `plans/postponed/`) stay HAND moves: each names a ground — the architecture a plan breaks, the
 * condition that would make it executable, the reason plus the signal that lifts a pause — and no tool
 * can decide those.
 */
const Parameters = Schema.Struct({
  reconcile: Schema.optional(Schema.Boolean).annotate({
    description:
      "Move the misplaced plans this report names, using the project's own reconciler: complete plans to plans_completed/, kernel-authored plans with open boxes back to plans/. Off by default — reading the state and changing it are different acts.",
  }),
})

export const PlanStatusTool = Tool.define(
  "planstatus",
  Effect.gen(function* () {
    return {
      description:
        "Gates: G3/G9 portfolio audit — progress, active/complete/debt across plans/. Principle: why = the one check that sees every plan's boxes; NOT completion — filename presence and DONE testimony prove nothing, only checked boxes do. " +
        "The repository's plan/tick report: the progress bar, which plans are active, which are complete, which sit in the WRONG terminal, and the full debt (open boxes across every plan). Reads plans/ and plans_completed/ only — plans_deferred/, plans/futures/ and plans/postponed/ are invisible BY DESIGN, because deferred, future and paused work is neither debt nor completion. Pass reconcile:true to move the misplaced plans it names.",
      parameters: Parameters,
      execute: (params: { reconcile?: boolean }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const worktree = ins.worktree
          if (params.reconcile === true) {
            // The permission is asked for the MUTATION only: reading the state needs no grant, and a
            // tool that asks for one anyway teaches the model that reads are gated.
            yield* ctx.ask({ permission: "planstatus", patterns: ["*"], always: ["*"], metadata: { worktree } })
          }
          const reconciled = params.reconcile === true ? reconcilePlans(worktree) : undefined
          const status = reconciled?.status ?? getPlanStatus(worktree)
          const debt = planDebt(worktree)
          const linked = parsePlanFiles(worktree)
          const unlinked = linked.filter((p) => !isPlanLinked(p)).map((p) => p.file)
          const output = [
            formatPlanHygiene(status, reconciled),
            `Debt: ${debt.open} open box(es) across ${debt.plans} plan(s) in plans/`,
            `Active: ${status.active.length} · Completed: ${status.completed.length} · Misplaced: ${status.misplaced.length}`,
            `Unlinked: ${unlinked.length} plan(s) name no master-plan goal${unlinked.length ? ` (${unlinked.join(", ")})` : ""}`,
          ].join("\n")
          return {
            title: `planstatus: ${status.active.length} active · ${debt.open} open box(es) · ${status.misplaced.length} misplaced · ${unlinked.length} unlinked`,
            metadata: {
              active: status.active.length,
              completed: status.completed.length,
              misplaced: status.misplaced.length,
              openBoxes: debt.open,
              plans: debt.plans,
              unlinked: unlinked.length,
              unlinkedPlans: unlinked,
              movedToCompleted: reconciled?.movedToCompleted ?? [],
              reopenedToActive: reconciled?.reopenedToActive ?? [],
              errors: reconciled?.errors ?? [],
            },
            output,
          }
        }),
    }
  }),
  "planstatus",
)
