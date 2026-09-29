/**
 * SVM — the manifest of ONE task, kept where a turn can reach it.
 *
 * Kernel §1.4: SVM is «the complete context of ONE atomic task … one task keeps one manifest,
 * updated per turn, never duplicated». The owner's plan-side additions (2026-09-29) are the same
 * object seen from the plan: a task carries its semantic VECTOR, a REF to its plan, and an
 * approximate number of TURNS until that plan moves to `plans_completed/` — plus the state it is
 * in and the oracle that would prove it done.
 *
 * Storage: the keyed plane that EXISTS (`Storage`) — key `["svm", "task", <planId>, <taskId>]`. The
 * plan is identified by its BASENAME WITHOUT the extension, because a key becomes a file path and a
 * plan path contains separators. There is no `remove` in `Storage`, and there should not be one here
 * either: a task that stops existing loses its plan file, and the plan-ref check reports the orphan
 * rather than silently dropping it (plan S5).
 *
 * The `Storage.Interface` is a PARAMETER, not a service looked up inside: `Tool.execute` may not
 * carry a service requirement (its effect is typed `R = never`), so a tool has to capture the store
 * at init and pass it in. One spelling per function, and a caller that already holds the store pays
 * nothing to use it.
 */
import { Effect } from "effect"
import { Storage } from "@/storage/storage"

export interface SVMRecord {
  /** Task id as it appears in the plan file, e.g. `S3`. */
  task: string
  /** The plan this task belongs to, as written in the repo, e.g. `plans/2026-09-29_x.md`. */
  plan: string
  /** The @SV_FORMAT block for this task — Keywords, dominant, md5 chain. */
  sv: string
  /** Approximate turns until this plan moves to `plans_completed/`. */
  etaTurns: number
  state: "doing" | "blocked" | "verified" | "waiting-on-user"
  /** What will PROVE it — the instrument, not the hope. */
  oracle: string
}

/** `plans/2026-09-29_x.md` → `2026-09-29_x`; the key must survive becoming a file path. */
export function planKey(planFile: string): string {
  const base = planFile.replaceAll("\\", "/").split("/").pop() ?? planFile
  return base.replace(/\.md$/i, "")
}

/** The store key of one task's manifest. Exported because it IS the contract with the store. */
export function taskKey(planFile: string, taskId: string): string[] {
  return ["svm", "task", planKey(planFile), taskId]
}

/** The manifest, or `undefined` when this task has never been given one — never an invented one. */
export const read = (storage: Storage.Interface, planFile: string, taskId: string) =>
  storage
    .read<SVMRecord>(taskKey(planFile, taskId))
    .pipe(Effect.catch(() => Effect.succeed(undefined as SVMRecord | undefined)))

export const write = (storage: Storage.Interface, planFile: string, record: SVMRecord) =>
  storage.write(taskKey(planFile, record.task), record)

/**
 * The tasks of `planFile` that carry no manifest — what the turn's reminder prints. The count is
 * returned even when it is zero, because a silent check is not a check.
 */
export const missing = (storage: Storage.Interface, planFile: string, taskIds: readonly string[]) =>
  Effect.gen(function* () {
    const found: string[] = []
    for (const id of taskIds) {
      if (!(yield* read(storage, planFile, id))) found.push(id)
    }
    return found
  })
