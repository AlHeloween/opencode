/**
 * Plan progress tracking + mechanical hygiene.
 *
 * Reads the `plans/` and `plans_completed/` directories at the worktree root
 * and returns completion statistics. Used by the orchestrator agent and
 * the AGI mode TUI progress bar.
 *
 * Completion criteria: A plan is COMPLETE if it has NO [ ] items.
 * [x] and [~] both count as complete — only [ ] means incomplete.
 *
 * Hygiene (reconcilePlans):
 *   - plans/* with no [ ]  → plans_completed/  (finished, standardized)
 *   - plans_completed/* with [ ] → plans/      (incomplete, reopened)
 *
 * True "all done" for AGI: active.length === 0 && misplaced.length === 0
 * (after reconcile, misplaced should be empty unless IO failed).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "fs"
import path from "path"

export interface PlanStatus {
  active: string[]
  completed: string[]
  misplaced: string[]
  totalPlans: number
  totalTasks: number
  completedTasks: number
  completion: number
}

export interface ReconcileResult {
  /** Relative paths moved plans/ → plans_completed/ */
  movedToCompleted: string[]
  /** Relative paths moved plans_completed/ → plans/ */
  reopenedToActive: string[]
  errors: string[]
  status: PlanStatus
}

/** Check if a plan file has any open [ ] items. */
export function hasOpenItems(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, "utf-8")
    return /^\s*- \[ \]/m.test(content)
  } catch {
    return false
  }
}

// ── Plan state mirror (GATED WORKFLOW snapshot for Layer-1 summaries) ──
//
// Kernel-native vocabulary: lifecycle enums, G1..G9 gates, per-task oracle
// status ([x]⇒PASS stamped at G8, [~]⇒PARTIAL, [ ]⇒PENDING). The payload is
// system Exact — parsed from plan files, never model-authored. Summaries fold
// it into m* so the model picks the workflow state up after every compact.

export interface PlanStateTask {
  id: string
  title: string
  sv: string[]
  status: "PASS" | "PARTIAL" | "PENDING"
  done_pct: number | null
  attempts: number
  last_failure?: string
}

export interface PlanStatePlan {
  file: string
  lifecycle?: string
  gate?: string
  goal_sv: string[]
  invariants: string[]
  tasks: PlanStateTask[]
}

export interface PlanStatePayload {
  plans: PlanStatePlan[]
}

/** Trailing metadata tags on a task line:
 *  `<!-- sv: a,b | done_pct: 40 | attempts: 2 | last_failure: why -->` */
function parseTaskTags(
  rest: string,
): { sv: string[]; done_pct: number | null; attempts: number; last_failure?: string } {
  const comment = rest.match(/<!--([^>]*)-->/)?.[1] ?? ""
  const sv = comment.match(/\bsv:\s*([^|>]*?)(?=\s*\||\s*$)/)?.[1]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? []
  const donePct = comment.match(/\bdone_pct:\s*(\d+)/)?.[1]
  const attempts = comment.match(/\battempts:\s*(\d+)/)?.[1]
  const lastFailure = comment.match(/\blast_failure:\s*([^>]*?)\s*$/m)?.[1]?.trim()
  return {
    sv,
    done_pct: donePct != null ? Number(donePct) : null,
    attempts: attempts != null ? Number(attempts) : 0,
    last_failure: lastFailure || undefined,
  }
}

function parseLifecycle(content: string): string | undefined {
  const workflow = content.match(
    /<!--\s*workflow:\s*lifecycle\s+(\w+)(?:\s*\|\s*gate\s*(G\d+))?\s*-->/,
  )
  if (workflow) return workflow[1]
  const status = content.match(/\*\*Status:\*\*\s*(\w+)/)?.[1]
  if (!status) return undefined
  const map: Record<string, string> = { PROPOSED: "DRAFT" }
  return map[status.toUpperCase()] ?? status.toUpperCase()
}

function parseGate(content: string): string | undefined {
  return content.match(/<!--\s*workflow:[^>]*gate\s*(G\d+)[^>]*-->/)?.[1]
}

/** Collect the GATED WORKFLOW mirror for all active plans (`plans/*.md`). */
export function collectPlanState(worktree: string): PlanStatePayload {
  const plansDir = path.join(worktree, "plans")
  const plans: PlanStatePlan[] = []
  for (const file of collectPlans(plansDir)) {
    let content: string
    try {
      content = readFileSync(path.join(plansDir, file), "utf-8")
    } catch {
      continue
    }
    const tasks: PlanStateTask[] = []
    for (const m of content.matchAll(/^\s*- \[( |x|~)\] (.+)$/gm)) {
      const checkbox = m[1]!
      const rest = m[2]!.trim()
      const bold = rest.match(/^\*\*([^*]+)\*\*(.*)$/)
      const structured = bold != null
      const header = bold?.[1] ?? rest
      const after = bold?.[2] ?? ""
      const id = structured
        ? header.match(/^([A-Za-z0-9_]+)/)?.[1] ?? header.slice(0, 12)
        : `TASK-${tasks.length + 1}`
      const title = structured
        ? header.replace(/^[A-Za-z0-9_]+\s*[—-]\s*/, "").trim()
        : rest
      const tags = parseTaskTags(structured ? after : "")
      tasks.push({
        id,
        title,
        sv: tags.sv,
        status: checkbox === "x" ? "PASS" : checkbox === "~" ? "PARTIAL" : "PENDING",
        done_pct: tags.done_pct,
        attempts: tags.attempts,
        last_failure: tags.last_failure,
      })
    }
    const invariants = content
      .match(/## Invariants\s*\n([\s\S]*?)(?=\n## |$)/)?.[1]
      ?.split("\n")
      .map((l) => l.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean) ?? []
    const goalSv =
      content.match(/<!--\s*goal_sv:\s*([^>]*?)\s*-->/)?.[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
    plans.push({
      file: `plans/${file.replace(/\\/g, "/")}`,
      lifecycle: parseLifecycle(content),
      gate: parseGate(content),
      goal_sv: goalSv,
      invariants,
      tasks,
    })
  }

  // Relevance filter — the mirror is the CURRENT workflow state, not an archive
  // (2026-08-28: live panel showed July-era SUPERSEDED/DONE plans flooding s).
  const KERNEL_LIFECYCLE = new Set([
    "DRAFT",
    "ACTIVE",
    "EXECUTING",
    "VERIFYING",
    "IMPLEMENTED",
    "COMPLETED",
    "INVALIDATED",
  ])
  const MAX_PLANS = 3
  const relevant = plans
    .filter((p) => {
      if (/readme\.md$/i.test(p.file)) return false
      if (p.lifecycle && !KERNEL_LIFECYCLE.has(p.lifecycle)) return false
      const open = p.tasks.filter((t) => t.status !== "PASS").length
      if (open === 0 && p.lifecycle !== "ACTIVE" && p.lifecycle !== "EXECUTING") return false
      return true
    })
    .sort((a, b) => (a.file < b.file ? 1 : -1)) // ISO prefixes: newest first
    .slice(0, MAX_PLANS)
  return { plans: relevant }
  }

/** Compact kernel-native text rendering — rides the Exact stamp into m* and the TUI panel.
  * Noise caps (2026-08-28): only open tasks per plan (PASS collapsed to a count),
  * `plan state: none active` for empty payloads, 1500-char hard cap. */
export function formatPlanStateText(payload: PlanStatePayload): string {
  if (!payload.plans.length) return "plan state: none active"
  const MAX_TASK_LINES = 8
  const MAX_CHARS = 1500
  const out: string[] = []
  for (const p of payload.plans) {
    const lines = [
      `plan: ${p.file} · lifecycle ${p.lifecycle ?? "UNKNOWN"}${p.gate ? ` · gate ${p.gate}` : ""}`,
      ...(p.goal_sv.length ? [`goal_sv: ${p.goal_sv.join(", ")}`] : []),
    ]
    const open = p.tasks.filter((t) => t.status !== "PASS")
    const passCount = p.tasks.length - open.length
    for (const t of open.slice(0, MAX_TASK_LINES)) {
      lines.push(
        `  ${t.id} [${t.status}]${t.done_pct != null ? ` done ${t.done_pct}%` : ""} · attempts ${t.attempts}` +
          (t.last_failure ? ` · last_failure: ${t.last_failure}` : "") +
          (t.sv.length ? ` · sv: ${t.sv.join(", ")}` : ""),
      )
    }
    if (open.length > MAX_TASK_LINES) lines.push(`  … +${open.length - MAX_TASK_LINES} more open`)
    if (passCount > 0) lines.push(`  PASS ×${passCount}`)
    if (p.invariants.length) lines.push("invariants:", ...p.invariants.map((i) => `  - ${i}`))
    out.push(lines.join("\n"))
  }
  let text = out.join("\n\n")
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS)
    const cut = text.lastIndexOf("\n")
    text = (cut > 0 ? text.slice(0, cut) : text) + "\n… truncated (planState cap)"
  }
  return text
}

/** Count all task checkboxes in a plan file: returns { total, done }.
 *  Done = [x] or [~], total = [ ] + [x] + [~]. */
function countTasks(filePath: string): { total: number; done: number } {
  try {
    const content = readFileSync(filePath, "utf-8")
    const pending = content.match(/^\s*- \[ \]/gm)?.length ?? 0
    const done = content.match(/^\s*- \[[x~]\]/gm)?.length ?? 0
    return { total: pending + done, done }
  } catch {
    return { total: 0, done: 0 }
  }
}

/** Collect .md filenames directly in a directory (flat, non-recursive). */
function collectPlans(dir: string): string[] {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Get plan completion status for a worktree. */
export function getPlanStatus(worktree: string): PlanStatus {
  const plansDir = path.join(worktree, "plans")
  const completedDir = path.join(worktree, "plans_completed")

  const allCompleted = collectPlans(completedDir)
  const allActive = collectPlans(plansDir)

  // A plan is complete if it has NO [ ] items (only [x] and [~] allowed)
  const completed = allCompleted.filter((f) => !hasOpenItems(path.join(completedDir, f)))
  const active = allActive.filter((f) => hasOpenItems(path.join(plansDir, f)))

  // Misplaced: plans in completedDir that still have [ ] items,
  // or plans in plansDir that have NO [ ] items (should be moved)
  const misplacedCompleted = allCompleted.filter((f) => hasOpenItems(path.join(completedDir, f)))
  const misplacedActive = allActive.filter((f) => !hasOpenItems(path.join(plansDir, f)))
  const misplaced = [
    ...misplacedCompleted.map((f) => `plans_completed/${f.replace(/\\/g, "/")}`),
    ...misplacedActive.map((f) => `plans/${f.replace(/\\/g, "/")}`),
  ]

  const totalPlans = allActive.length + allCompleted.length

  // Count tasks across ALL plan files
  let totalTasks = 0
  let completedTasks = 0
  for (const f of allCompleted) {
    const { total, done } = countTasks(path.join(completedDir, f))
    totalTasks += total
    completedTasks += done
  }
  for (const f of allActive) {
    const { total, done } = countTasks(path.join(plansDir, f))
    totalTasks += total
    completedTasks += done
  }

  // Completion uses fully standardized completed files only (in plans_completed, no open items)
  const completion = totalPlans > 0 ? Math.round((completed.length / totalPlans) * 100) : 0

  return {
    active: active.map((f) => f.replace(/\\/g, "/")),
    completed: completed.map((f) => f.replace(/\\/g, "/")),
    misplaced,
    totalPlans,
    totalTasks,
    completedTasks,
    completion,
  }
}

/** True when no open work remains and directories are standardized. */
export function isPlanHygieneClean(status: PlanStatus): boolean {
  return status.active.length === 0 && status.misplaced.length === 0
}

function uniqueDest(dest: string): string {
  if (!existsSync(dest)) return dest
  const ext = path.extname(dest)
  const base = ext ? dest.slice(0, -ext.length) : dest
  let i = 1
  while (existsSync(`${base}_${i}${ext}`)) i++
  return `${base}_${i}${ext}`
}

function movePlanFile(from: string, to: string): string {
  const destDir = path.dirname(to)
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
  const dest = uniqueDest(to)
  renameSync(from, dest)
  return dest
}

/**
 * Mechanically reconcile plan directories to match AGENTS.md conventions.
 * Does not edit checkbox content — only moves files by open-item presence.
 */
export function reconcilePlans(worktree: string): ReconcileResult {
  const plansDir = path.join(worktree, "plans")
  const completedDir = path.join(worktree, "plans_completed")
  const movedToCompleted: string[] = []
  const reopenedToActive: string[] = []
  const errors: string[] = []

  if (!existsSync(plansDir)) {
    try {
      mkdirSync(plansDir, { recursive: true })
    } catch (e) {
      errors.push(`mkdir plans: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (!existsSync(completedDir)) {
    try {
      mkdirSync(completedDir, { recursive: true })
    } catch (e) {
      errors.push(`mkdir plans_completed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Finished files sitting in plans/ → plans_completed/
  for (const rel of collectPlans(plansDir)) {
    const src = path.join(plansDir, rel)
    if (hasOpenItems(src)) continue
    try {
      const dest = movePlanFile(src, path.join(completedDir, rel))
      const finalRel = path.relative(completedDir, dest).replace(/\\/g, "/")
      movedToCompleted.push(finalRel)
    } catch (e) {
      errors.push(`move to completed ${rel}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Incomplete files sitting in plans_completed/ → plans/
  for (const rel of collectPlans(completedDir)) {
    const src = path.join(completedDir, rel)
    if (!hasOpenItems(src)) continue
    try {
      const dest = movePlanFile(src, path.join(plansDir, rel))
      const finalRel = path.relative(plansDir, dest).replace(/\\/g, "/")
      reopenedToActive.push(finalRel)
    } catch (e) {
      errors.push(`reopen to active ${rel}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    movedToCompleted,
    reopenedToActive,
    errors,
    status: getPlanStatus(worktree),
  }
}

/** Footer appended to AGI worker directives — plan hygiene + smoke-before-impl duties. */
export function planHygieneWorkerFooter(): string {
  return [
    "",
    "=== PLAN HYGIENE (required) ===",
    "REUSE.BEFORE: before non-trivial invent/build (and when stuck after failures), use universalsearch web and/or Sourcegraph code — do not reinvent the wheel.",
    "PRE_FLIGHT: plan must have ## Smoke Tests (or smoke: N/A). Record baseline [Exact] before first implementation edit.",
    "Non-trivial plans: note ## Prior art (universalsearch) or reuse: N/A. Do not implement if Smoke Tests are missing. Vague 'test later' is forbidden.",
    "After implementation: re-run post-impl smoke oracles; mark plan checkboxes [x] only when verified in code and smoke passes.",
    "If a plan under plans/ has no remaining [ ] items, move it to plans_completed/.",
    "Never leave fully-checked plans in plans/. Never leave open [ ] in plans_completed/.",
    "Update master plan references when a subordinate plan is completed.",
  ].join("\n")
}

/** One-line hygiene summary for orch prompts. */
export function formatPlanHygiene(status: PlanStatus, reconcile?: ReconcileResult): string {
  const lines = [
    `Plan progress: ${formatProgressBar(status)}`,
    `Active (open [ ]): ${status.active.join(", ") || "none"}`,
    `Misplaced: ${status.misplaced.join(", ") || "none"}`,
  ]
  if (reconcile) {
    if (reconcile.movedToCompleted.length) {
      lines.push(`Moved to plans_completed/: ${reconcile.movedToCompleted.join(", ")}`)
    }
    if (reconcile.reopenedToActive.length) {
      lines.push(`Reopened to plans/: ${reconcile.reopenedToActive.join(", ")}`)
    }
    if (reconcile.errors.length) {
      lines.push(`Hygiene errors: ${reconcile.errors.join("; ")}`)
    }
  }
  if (!isPlanHygieneClean(status)) {
    lines.push(
      "HYGIENE DEBT: next work MUST fix checkboxes / file locations before new features.",
    )
  }
  return lines.join("\n")
}

/** Render a simple ASCII progress bar with task-level stats. */
export function formatProgressBar(status: PlanStatus): string {
  const width = 20
  const filled = Math.round((status.completion / 100) * width)
  const empty = width - filled
  const base = `[${"█".repeat(filled)}${"░".repeat(empty)}] ${status.completed.length}/${status.totalPlans} plans ${status.completedTasks}/${status.totalTasks} tasks (${status.completion}%)`
  if (status.misplaced.length === 0) return base
  return `${base} misplaced:${status.misplaced.length}`
}
