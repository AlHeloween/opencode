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
import { Global } from "@opencode-ai/core/global"
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

/**
 * The manifest as the TURN NOTE needs it — read SERVICE-FREE.
 *
 * Why not through the store: the note is built on the prompt path, and a service requirement there
 * propagates into every layer that provides `SessionPrompt` (the trade `tool/memory.ts` names and
 * answers the same way). Why `Global.Path.data` and not the caller's worktree: the invariant that
 * matters is AGREEMENT with the writer, not any particular directory — the service captures its root
 * from that same path, so a reader rooted anywhere else (the session's worktree, say) reports every
 * manifest as MISSING while the store holds them, silently and permanently. Measured 2026-09-30: under
 * the test fixture the service writes to `TEST_TEMP/.opencode/data`, not to the per-test tmpdir — so a
 * reader that "obviously" belonged next to the worktree would have been wrong in every test and in no
 * production run, which is the worst possible place to be wrong. The file itself comes from
 * `Storage.keyFile`, the store's OWN mapping, so the path cannot drift even in spelling.
 *
 * Never throws and never invents: absent, unreadable or malformed ⇒ `null`. A reader that threw would
 * take the WHOLE note down with it (`prompt.ts` catches that builder and returns an empty string), so
 * one missing manifest would blank a status surface.
 */
export function readNote(
  planFile: string,
  taskId: string,
): Effect.Effect<{ task: string; dominant: string; etaTurns: number; state: SVMRecord["state"] } | null> {
  return Effect.tryPromise(async () => {
    const file = Bun.file(Storage.keyFile(Global.Path.data, taskKey(planFile, taskId)))
    if (!(await file.exists())) return null
    const record = (await file.json()) as SVMRecord
    return { task: record.task, dominant: dominantOf(record.sv), etaTurns: record.etaTurns, state: record.state }
  }).pipe(Effect.catch(() => Effect.succeed(null)))
}

/**
 * The dominant line of an `@SV_FORMAT` block. A block that carries none SAYS SO: absence reads as
 * FALSE, and an empty string would render as a manifest that exists and tells the reader nothing.
 */
export function dominantOf(sv: string): string {
  const text = sv
    .split("\n")
    .find((line) => /^\s*semantic dominant:/i.test(line))
    ?.replace(/^\s*semantic dominant:\s*/i, "")
    .trim()
  return text ? text : "(dominant not stated)"
}
