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
import { existsSync, readFileSync, readdirSync } from "fs"
import path from "path"
import { Effect } from "effect"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Storage } from "@/storage/storage"
import {
  MASTER_PLAN_FILE,
  RENDER_MARKER,
  getPlanStatus,
  masterPlanCoverage,
  parsePlanFiles,
  type PlanStatePlan,
} from "@/util/plan-status"

const log = Log.create({ service: "session.svm" })

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
 * WHERE A RECORD'S PLAN REF STANDS — the predicate plan S5 names, in ONE spelling.
 *
 * A record's `plan:` is a path into the worktree, and a ref that resolves to nothing is the defect:
 * the store has no `remove` (see this file's header), so such a record would sit there for good,
 * reading as a direction somebody once chose.
 *
 * `moved` is kept apart from `deleted` because the remedies differ — update the ref, or accept that
 * the record outlived its task — the same split `masterPlanCoverage` makes between «no master plan at
 * all» and «a master plan that missed a plan». Both are findings; neither is folded into the other.
 */
export function resolvePlan(worktree: string, plan: string): "present" | "moved" | "deleted" {
  if (existsSync(path.join(worktree, plan))) return "present"
  // The plan may have MOVED rather than died, and saying which is the whole point of the finding.
  return existsSync(path.join(worktree, "plans_completed", `${planKey(plan)}.md`)) ? "moved" : "deleted"
}

/** One manifest the store holds whose plan ref no longer resolves. */
export interface OrphanManifest {
  /** The path a reader would follow and find nothing at. */
  plan: string
  task: string
  reason: "moved" | "deleted"
}

/**
 * THE PLAN-REF INVARIANT (plan S5): every manifest in the store whose plan file is gone.
 *
 * WHY THE STORE IS ENUMERATED rather than walked plan by plan: a record whose plan has LEFT is
 * precisely the record a plan-by-plan walk can never reach. The map is built FROM the plan files, so
 * an orphan is invisible there by construction — it would live in the store for good, and nothing
 * would ever say so.
 *
 * WHY THE KEY IS USUALLY ENOUGH: a key IS `["svm","task",<planId>,<taskId>]`, so the store's own
 * LAYOUT already answers both questions — the directory is the plan, the file name is the task — and
 * the common case (the plan is still there) costs one readdir and ZERO parses. Only a record that
 * does NOT resolve is read, to take its recorded `plan` LITERALLY: that is the predicate S5 states
 * («names a file that does not exist»), and it is what stops a record legitimately written against
 * `plans_completed/…` from being called an orphan. Cheap while it resolves, exact when it does not.
 *
 * SERVICE-FREE for the reason `readNote` is — this runs on the prompt path — and it never throws: a
 * store nothing has been written to yet is a store with nothing to report, not a broken note.
 */
export function orphanManifests(worktree: string): { checked: number; orphans: OrphanManifest[] } {
  const root = Storage.keyDir(Global.Path.data, ["svm", "task"])
  let planDirs: string[]
  try {
    planDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch (e) {
    log.debug("no svm store to enumerate", { root, error: e instanceof Error ? e.message : String(e) })
    return { checked: 0, orphans: [] }
  }

  const orphans: OrphanManifest[] = []
  let checked = 0
  for (const planDir of planDirs) {
    let tasks: string[]
    try {
      tasks = readdirSync(path.join(root, planDir), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -".json".length))
        .sort()
    } catch (e) {
      log.debug("svm store directory unreadable — skipped, never invented", {
        planDir,
        error: e instanceof Error ? e.message : String(e),
      })
      continue
    }
    const keyed = `plans/${planDir}.md`
    const keyResolves = existsSync(path.join(worktree, keyed))
    for (const task of tasks) {
      checked += 1
      if (keyResolves) continue
      // TIER TWO: the key does not resolve, so the record is read and its own `plan` taken literally.
      const ref = storedRecord(planDir, task)?.plan ?? keyed
      const state = resolvePlan(worktree, ref)
      if (state !== "present") orphans.push({ plan: ref, task, reason: state })
    }
  }
  return { checked, orphans }
}

/** One stored record, or `undefined` — read through the store's OWN mapping (`keyFile`), never a path
 *  composed here. A record that cannot be read is absent, not invented, and the caller then judges the
 *  KEY instead of the record. */
function storedRecord(planDir: string, taskId: string): SVMRecord | undefined {
  try {
    const file = Storage.keyFile(Global.Path.data, ["svm", "task", planDir, taskId])
    return JSON.parse(readFileSync(file, "utf-8")) as SVMRecord
  } catch (e) {
    log.debug("svm record unreadable — treated as absent, never invented", {
      planDir,
      taskId,
      error: e instanceof Error ? e.message : String(e),
    })
    return undefined
  }
}

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
    return summarize(record)
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

/**
 * The manifest as a READER wants it: the dominant EXTRACTED from the block, plus distance and state.
 *
 * ONE spelling for every reader of the store. `read` returns the raw record, where the dominant is a line
 * inside `sv` — and a second reader that addressed `record.dominant` would print `undefined` while looking
 * perfectly reasonable. Measured 2026-09-30: `renderBody` did exactly that, and its own test caught it.
 */
export function summarize(record: SVMRecord) {
  return { task: record.task, dominant: dominantOf(record.sv), etaTurns: record.etaTurns, state: record.state }
}

/** What one render found — printed by the tool, asserted by the test. */
export interface RenderStats {
  plans: number
  openBoxes: number
  /** A plan with no `<!-- intention -->` header states no direction at all. */
  missingPlanSv: number
  /** An open box with no `<!-- sv: … -->` tag. */
  missingTaskSv: number
  /** An open box with no manifest in the store. */
  missingManifests: number
  /** Plans the file named BEFORE this render and does not name now — the map was stale. */
  gapsBefore: string[]
}

/**
 * `render` — the master plan's generated BODY, derived from the two sources and nothing else (plan S4).
 *
 * WHY it returns text instead of writing the file: the content is then assertable byte-for-byte in a test
 * with no filesystem side effect, and exactly one place (the tool) knows the path. Writing is an effect; the
 * derivation is a measurement.
 *
 * WHY every value is READ: a plan's vector comes from its own `<!-- intention -->` / `<!-- goal_sv -->`
 * header, a task's from the `<!-- sv: … -->` tag on its box, an in-flight manifest from the store. One that
 * is absent is printed as MISSING — never filled in, never quietly skipped, because a render that supplies a
 * missing vector is a render that invented the direction of the tree.
 *
 * WHY determinism is part of the contract (owner: two renders in a row must be byte-identical): plans are
 * SORTED by path (`readdirSync` order is not a promise), tasks keep their file order, and NO CLOCK IS READ —
 * the date lives in the hand-owned head, which this body never contains.
 */
export function renderBody(
  worktree: string,
  storage: Storage.Interface,
): Effect.Effect<{ body: string; stats: RenderStats }> {
  return Effect.gen(function* () {
    const plans: PlanStatePlan[] = [...parsePlanFiles(worktree)].sort((a, b) => a.file.localeCompare(b.file))
    const status = getPlanStatus(worktree)
    const coverage = masterPlanCoverage(worktree)

    // THE MAP IS BUILT FIRST, and the counts fall out of it: the table above it must report the same
    // boxes the reader can count below, or the file contains two answers to one question.
    const map: string[] = []
    let openBoxes = 0
    let missingPlanSv = 0
    let missingTaskSv = 0
    let missingManifests = 0
    for (const plan of plans) {
      const open = plan.tasks.filter((task) => task.status !== "PASS")
      openBoxes += open.length
      map.push("")
      map.push(
        `- \`${plan.file}\` — ${open.length} open / ${plan.tasks.length} box(es) · lifecycle ${plan.lifecycle ?? "UNKNOWN"}`,
      )
      if (plan.intention) {
        map.push(
          `  sv: intention "${plan.intention.from_state} -> ${plan.intention.to_state}" · keywords [${plan.goal_sv.join(", ")}]`,
        )
      } else {
        missingPlanSv += 1
        map.push("  sv: MISSING — the plan states no `<!-- intention: … -->` header, so nothing says what it is for")
      }
      if (open.length === 0) {
        map.push("  - no open box")
        continue
      }
      for (const task of open) {
        const record = yield* read(storage, plan.file, task.id)
        if (task.sv.length === 0) missingTaskSv += 1
        if (!record) missingManifests += 1
        map.push(
          `  - ${task.id} [${task.status}] · sv ${task.sv.length ? `[${task.sv.join(", ")}]` : "MISSING"} · manifest: ${
            record ? `${summarize(record).dominant} · eta ${record.etaTurns} · ${record.state}` : "MISSING — nobody has written down what this box is"
          }`,
        )
      }
    }

    const lines = [
      "## Where the work stands",
      "",
      "| | count |",
      "|---|---|",
      `| plans completed | ${status.completed.length} |`,
      `| plans active | ${status.active.length} |`,
      `| tasks passed / total | ${status.completedTasks} / ${status.totalTasks} |`,
      `| open boxes | ${openBoxes} |`,
      "",
      "Counts read from the same instrument `planstatus` uses; nothing here is retyped.",
      "",
      "## The map",
      "",
      "Every plan under `plans/`, with every vector READ from its own source. `MISSING` means the source has none — it is never filled in here, and the source wins over anything printed below.",
      ...map,
      "",
      "## The checks",
      "",
      `This body names all ${plans.length} plan(s) under \`plans/\` as they stand now: a plan that appears there appears here on the next render, and one that leaves, leaves.`,
      "",
      "That statement is about NOW on purpose. A body that reported the state of the PREVIOUS file would change the instant it was written, and a re-run could never be byte-identical — measured 2026-09-30, when the first version did exactly that and its own acceptance («two renders in a row are byte-identical») caught it. Whether the map was STALE before this render is a delta, so the tool that ran the render reports it (`gapsBefore`) and this file never stores it.",
    ]

    const stats: RenderStats = {
      plans: plans.length,
      openBoxes,
      missingPlanSv,
      missingTaskSv,
      missingManifests,
      gapsBefore: coverage.misses,
    }
    return { body: lines.join("\n") + "\n", stats }
  })
}

/**
 * The render as an OPERATION: read the hand-owned head, refuse if there is nothing to render into, generate
 * the body, write the file.
 *
 * WHY the whole operation lives here and not in the tool: a surface that assembled the head and the body
 * itself would be a SECOND implementation of the same write, and the probe that smokes the renderer against
 * the real repository would then be testing a copy of it. One function, one write path — the tool only
 * formats the reply.
 *
 * The two refusals are the interesting part. A missing file and a file without `RENDER_MARKER` are refused
 * for the same reason: the GOAL lives in the hand-owned head, and a renderer that invented it would be
 * inventing the direction of the whole tree.
 */
export function applyRender(
  worktree: string,
  storage: Storage.Interface,
): Effect.Effect<
  | { ok: true; file: string; bytes: number; stats: RenderStats }
  | { ok: false; reason: string }
> {
  return Effect.gen(function* () {
    const target = path.join(worktree, MASTER_PLAN_FILE)
    const head = yield* Effect.promise(async () => {
      const file = Bun.file(target)
      return (await file.exists()) ? await file.text() : null
    })
    if (head === null) {
      return {
        ok: false as const,
        reason:
          `${MASTER_PLAN_FILE} does not exist. The GOAL lives in that file's hand-owned head, and inventing ` +
          `the direction of the tree is the one thing this renderer must never do. Create the file with a head ` +
          `(\`## Goal — level 0\` carrying its own sv) and the marker line \`${RENDER_MARKER}\`, then render.`,
      }
    }
    const cut = head.indexOf(RENDER_MARKER)
    if (cut === -1) {
      return {
        ok: false as const,
        reason:
          `${MASTER_PLAN_FILE} carries no render marker. Without it there is no way to tell the hand-owned head ` +
          `from a body a previous render produced, so writing would risk overwriting the head. Add ` +
          `\`${RENDER_MARKER}\` where the generated part begins.`,
      }
    }
    const { body, stats } = yield* renderBody(worktree, storage)
    const content = `${head.slice(0, cut + RENDER_MARKER.length)}\n\n${body}`
    yield* Effect.promise(() => Bun.write(target, content))
    return { ok: true as const, file: MASTER_PLAN_FILE, bytes: content.length, stats }
  })
}
