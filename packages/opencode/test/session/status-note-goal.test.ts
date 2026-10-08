import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import * as Compaction from "../../src/session/compaction"
import type { MessageV2 } from "../../src/session/message-v2"
import { collectPlanState, parsePlanFiles, planDebt, type PlanStatePlan, type PlanStateTask } from "../../src/util/plan-status"

/**
 * The status note must name the SESSION's own goal (owner, 2026-10-08).
 *
 * Observed in the robot sessions' own turns: every `<compaction-status>` note named
 * `plans/2026-10-08_org-verbs-and-heartbeat.md` — the newest plan file on disk — whatever brief the
 * session had been given. The address came from `owedTasks(collectPlanState(worktree))[0]`, and
 * `collectPlanState` sorts by ISO prefix: the newest file first, the session never consulted.
 *
 * The namespace import is deliberate: this file must RUN on the pre-fix tree, where `sessionTarget`
 * and `sessionSignals` do not exist yet. A named import would fail to LINK, and every case below —
 * including the behavioural ones that reproduce the defect — would report a module error instead of
 * the defect itself.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A worktree holding exactly the given plan files (`<name>` → body). */
function worktreeWith(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "status-note-"))
  dirs.push(dir)
  mkdirSync(path.join(dir, "plans"), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(path.join(dir, "plans", name), body)
  return dir
}

/** One open box — the shape `parsePlanFiles` reads (bold id, `- [ ]`, a `##` section). */
function planBody(taskId: string, title: string): string {
  return [
    `# ${title}`,
    "",
    "<!-- workflow: lifecycle ACTIVE | gate G7 -->",
    "<!-- intention: a state -> b state -->",
    "",
    "## Plan",
    "",
    `- [ ] **${taskId}** — ${title}`,
    "",
  ].join("\n")
}

const ALPHA = "plans/2026-10-01_alpha.md"
const BETA = "plans/2026-10-08_beta.md" // newer ISO prefix — the file the OLD note always named

function fixture(): { dir: string; plans: PlanStatePlan[]; debt: { plans: number; open: number } } {
  const dir = worktreeWith({
    [path.basename(ALPHA)]: planBody("A1", "alpha work"),
    [path.basename(BETA)]: planBody("B1", "beta work"),
  })
  return { dir, plans: parsePlanFiles(dir), debt: planDebt(dir) }
}

/** The task of a plan, read through the same parser the note's input comes from. */
function firstTask(plans: PlanStatePlan[], plan: string): PlanStateTask {
  return plans.find((candidate) => candidate.file === plan)!.tasks[0]!
}

/**
 * The CALLER's composition (`session/prompt.ts`), driven through the same three functions it uses:
 * the session's own signals → its plan and that plan's first open task → the note. `svm` is handed
 * in as the caller spells it — the manifest of the task the note names; `null` = no manifest yet.
 */
function noteFor(input: { dir: string; plans: PlanStatePlan[]; messages: Compaction.SessionSignal[] }): string {
  const own = Compaction.sessionTarget({ messages: input.messages, plans: input.plans })
  const svm = own.next === null ? null : { plan: own.next.plan, task: own.next.task.id, manifest: null }
  return Compaction.tailNote({
    open: [],
    window: null,
    debtTotal: planDebt(input.dir),
    own: { plan: own.plan, task: own.next?.task ?? null },
    svm,
  })
}

describe("the note's goal line belongs to the session", () => {
  test("two sessions with two tasks get TWO goal lines — never the same one", () => {
    const { plans, debt } = fixture()
    // What the pre-fix caller handed in: the capped head surface, newest first. It is still passed
    // here so the failure of the OLD code is the defect itself (one shared address) and not a blank.
    const capped = { plans: [...plans].reverse() }
    const note = (plan: string, task: PlanStateTask) =>
      Compaction.tailNote({
        open: [],
        window: null,
        debt: capped,
        debtTotal: debt,
        own: { plan, task },
        svm: null,
      })

    const alpha = note(ALPHA, firstTask(plans, ALPHA))
    const beta = note(BETA, firstTask(plans, BETA))

    // The falsifier, verbatim: two sessions bound to two plans must not share a goal line.
    expect(alpha).toContain(`next: ${ALPHA} A1 [PENDING]`)
    expect(beta).toContain(`next: ${BETA} B1 [PENDING]`)
    expect(alpha).not.toBe(beta)
    expect(alpha).not.toContain("beta")
    expect(beta).not.toContain("alpha")
  })

  test("a session that names no plan says so — it never inherits another session's plan", () => {
    const { plans, debt } = fixture()
    const note = Compaction.tailNote({
      open: [],
      window: null,
      debt: { plans },
      debtTotal: debt,
      own: { plan: null, task: null },
      svm: null,
    })

    expect(note).toContain("no plan bound to this session")
    expect(note).not.toContain("alpha")
    expect(note).not.toContain("beta")
  })

  test("a bound plan whose boxes are clear is stated, not filled in with somebody else's work", () => {
    const { plans, debt } = fixture()
    const note = Compaction.tailNote({
      open: [],
      window: null,
      debt: { plans },
      debtTotal: debt,
      own: { plan: ALPHA, task: null },
      svm: null,
    })

    expect(note).toContain(`next: none in ${ALPHA} — its boxes are clear`)
    expect(note).not.toContain("B1")
  })

  test("control — a caller with no session context keeps the old contract", () => {
    const { dir, plans, debt } = fixture()
    // The payload the pre-fix caller handed in: `collectPlanState` orders by ISO prefix, newest
    // first, so `owed[0]` is the newest plan's first open box — the mechanism the report names.
    const note = Compaction.tailNote({ open: [], window: null, debt: collectPlanState(dir), debtTotal: debt })
    expect(note).toContain(`next: ${BETA} B1 [PENDING]`)

    // No plan context at all ⇒ still no debt line, and the whole note stays empty.
    expect(Compaction.tailNote({ open: [], window: null })).toBe("")
  })
})

describe("the session's plan is read from ITS OWN messages", () => {
  test("two briefs resolve to two plans, each with that plan's first open task", () => {
    const { plans } = fixture()

    const alpha = Compaction.sessionTarget({ messages: [{ text: `Your task: work on ${ALPHA} until it is done.` }], plans })
    const beta = Compaction.sessionTarget({ messages: [{ text: `Read ${BETA} and finish its boxes.` }], plans })

    expect(alpha.plan).toBe(ALPHA)
    expect(alpha.next?.task.id).toBe("A1")
    expect(beta.plan).toBe(BETA)
    expect(beta.next?.task.id).toBe("B1")
  })

  test("the newest signal wins, and a plan file the session WROTE is its own", () => {
    const { plans } = fixture()

    const moved = Compaction.sessionTarget({
      messages: [{ text: `start on ${ALPHA}` }, { text: "…" }, { text: `now do ${BETA}` }],
      plans,
    })
    expect(moved.plan).toBe(BETA)

    const authored = Compaction.sessionTarget({
      messages: [{ text: "I will write the plan myself.", writes: [ALPHA] }],
      plans,
    })
    expect(authored.plan).toBe(ALPHA)

    // A write outranks a quote inside ONE message: the file was made, the other path was read out.
    const both = Compaction.sessionTarget({ messages: [{ text: `see ${BETA}`, writes: [ALPHA] }], plans })
    expect(both.plan).toBe(ALPHA)
  })

  test("a path that resolves to no plan on disk binds nothing", () => {
    const { plans } = fixture()
    const target = Compaction.sessionTarget({ messages: [{ text: "work on plans/2026-10-08_ghost.md" }], plans })

    expect(target.plan).toBeNull()
    expect(target.next).toBeNull()
  })
})

describe("which signals can bind a session to a plan", () => {
  test("write/edit filePaths are signals, a read is not, and text is read as written", () => {
    const part = (tool: string, filePath: string) => ({
      type: "tool",
      callID: "c1",
      tool,
      state: { status: "completed", input: { filePath } },
    })
    const message = (parts: unknown[]) => ({ info: {}, parts }) as unknown as MessageV2.WithParts

    const signals = Compaction.sessionSignals([
      message([
        { type: "text", text: `see ${ALPHA}` },
        part("read", BETA),
        part("write", "plans/2026-10-08_gamma.md"),
      ]),
      message([part("edit", "plans/2026-10-08_delta.md")]),
    ])

    expect(signals[0]!.text).toContain(ALPHA)
    expect(signals[0]!.writes).toEqual(["plans/2026-10-08_gamma.md"])
    expect(signals[1]!.writes).toEqual(["plans/2026-10-08_delta.md"])
  })
})

describe("the whole chain, session → note", () => {
  test("a session briefed on alpha is told about alpha — and its svm line names the same task", () => {
    const { dir, plans } = fixture()
    const note = noteFor({ dir, plans, messages: [{ text: `Work on ${ALPHA} until it is done.` }] })

    expect(note).toContain(`next: ${ALPHA} A1 [PENDING]`)
    expect(note).toContain(`svm: MISSING for ${ALPHA} A1`)
    expect(note).not.toContain("beta")
  })

  test("a session with no plan at all is told exactly that", () => {
    const { dir, plans } = fixture()
    const note = noteFor({ dir, plans, messages: [{ text: "hello — no plan named in this brief" }] })

    expect(note).toContain("no plan bound to this session")
    expect(note).not.toContain("alpha")
    expect(note).not.toContain("beta")
  })
})
