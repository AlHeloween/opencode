import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { TAIL_NOTE_PREFIX, tailNote, type WindowState } from "../../src/session/compaction"
import { formatWindow } from "../../src/tool/checkstate"
import { IncrementalCheckpoint } from "../../src/session/incremental-checkpoint"
import { Instance } from "../../src/project/instance"
import { MessageID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session as SessionNs } from "@/session/session"
import { provideInstance, tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

// One Instance boot for the folded-summary control; the rest of the file is pure.
setDefaultTimeout(20_000)

/**
 * The pushed compaction note (T3+T4 of
 * `plans/2026-09-18_summary-template-tool-and-fold-countdown.md`): the nag
 * names an OPEN summary's gaps while its body is still editable, and the
 * countdown carries the same numbers `checkstate` prints — one gauge, two
 * surfaces.
 */
const WINDOW: WindowState = {
  open: 90_000,
  foldAt: 120_000,
  sinceSummary: 12_345,
  perTurn: 7_500,
}

/** Over 200 chars, missing Next Steps / Critical Context / Relevant Files. The Plan section IS
 * present: this fixture is about the nag naming the sections that are absent, and a fixture that
 * silently lacked a required heading would only prove the nag can list the wrong one. */
const BODY_WITH_GAPS = [
  "## Semantic Vector",
  'dominant: "gaps are named while the summary is still open"',
  "",
  "## Goal",
  "Prove the nag names the deficient sections of an open summary instead of letting the fold carry a stub forward.",
  "",
  "## Plan",
  "Step 1: render the note. Step 2: name every heading whose body is short.",
  "",
  "## Constraints & Preferences",
  "The note rides the newest user message and never the stable system prefix.",
  "",
  "## Current state",
  "### Done",
  "The renderer exists and is pinned by this file.",
  "### In Progress",
  "The injection into the request tail is being wired.",
  "### Blocked",
  "Nothing blocked here at all.",
  "",
  "## Key decisions",
  "- Gaps are computed on read, so filling a section retires its own nag.",
].join("\n")

/** The complete anchored template — a body with no gaps (see summary-template.test.ts). */
const BODY_COMPLETE = [
  "## Semantic Vector",
  "dominant: continuity of the agent across folds",
  "",
  "## Goal",
  "Carry the account of the work across a fold so the next window can rely on it without re-deriving.",
  "",
  "## Plan",
  "Step 1: keep the template a union. Step 2: name every deficient heading.",
  "",
  "## Constraints & Preferences",
  "Diffs are attached by the system and must not be written into the prose.",
  "",
  "## Current state",
  "### Done",
  "The validator now names the anchored template's sections.",
  "### In Progress",
  "The forced gap-fill iteration is still in place.",
  "### Blocked",
  "Nothing blocked.",
  "",
  "## Key decisions",
  "- The template is a union, not a replacement: Semantic Vector stays.",
  "",
  "## Next Steps",
  "Remove the forced repair and store the body with its gaps named.",
  "",
  "## Critical Context",
  "A gapped body is still worth more than no checkpoint at all, because continuity outranks completeness.",
  "",
  "## Relevant Files",
  "packages/opencode/src/session/compaction.ts: the template and its validator live here.",
].join("\n")

describe("the pushed compaction note", () => {
  test("an open summary's gaps are named, with the tool that can fill them", () => {
    const note = tailNote({ open: [{ id: "ckpt_01", body: BODY_WITH_GAPS }], window: null })
    expect(note).toContain("summary ckpt_01 open")
    expect(note).toContain("gaps: Next Steps (0/24 chars)")
    expect(note).toContain("Relevant Files (0/24 chars)")
    expect(note).toContain("fill with summaryedit before the fold")
  })

  test("a complete open summary gets a quiet line, without a gap list", () => {
    const note = tailNote({ open: [{ id: "ckpt_02", body: BODY_COMPLETE }], window: null })
    expect(note).toContain("summary ckpt_02 open · no gaps")
    expect(note).not.toContain("gaps:")
  })

  test("the countdown carries the same numbers as checkstate's window block", () => {
    const note = tailNote({ open: [], window: WINDOW })
    const block = formatWindow({
      model: "deepseek/deepseek-v4",
      limit: 1_005_808,
      foldAt: WINDOW.foldAt,
      open: WINDOW.open,
      perTurn: WINDOW.perTurn,
      armed: false,
      auto: true,
    })
    for (const token of ["90,000", "120,000", "30,000", "4 more turns", "7,500/turn"]) {
      expect(note).toContain(token)
      expect(block).toContain(token)
    }
    expect(note).toContain("layer-1 12,345/65,536")
  })

  test("an unknown burn rate is reported as unknown, not as zero turns", () => {
    const note = tailNote({ open: [], window: { ...WINDOW, perTurn: null } })
    expect(note).toContain("burn rate unknown")
    expect(note).not.toContain("more turn")
  })

  test("nothing to report produces nothing to inject", () => {
    // The injection is guarded by `if (statusNote)`: an empty string must mean
    // "write no part", never an empty block in the transcript.
    expect(tailNote({ open: [], window: null })).toBe("")
  })

  test("the push names the DEBT — the protocol's call to action, not a statistic", () => {
    // The sidecar capture was the only event in the loop that came from the MACHINE rather than from
    // the user: a cadence-driven demand for an account of the work. With it gone, the protocol is
    // triggered by the user alone — an oracle it is not allowed to have (owner, 2026-09-22: «мы убили
    // call to action вместе с sidecar summaries … протокол перестает работать, с единственным
    // оракулом — пользователь, который оракулом по протоколу являться не может»). This line is that
    // demand, restored on the channel that already exists.
    const debt = {
      plans: [
        {
          file: "plans/2026-09-21_x.md",
          lifecycle: "ACTIVE",
          intention: { from_state: "a", to_state: "b" },
          goal_sv: [],
          invariants: [],
          tasks: [
            { id: "T7", title: "a finished task", sv: [], status: "PASS" as const, done_pct: 100, attempts: 0 },
            { id: "T8", title: "an open task", sv: ["head"], status: "PENDING" as const, done_pct: null, attempts: 2 },
          ],
        },
      ],
    }
    const note = tailNote({ open: [], window: WINDOW, debt })
    expect(note).toContain("owed: 1 open plan task(s)")
    expect(note).toContain("plans/2026-09-21_x.md T8 [PENDING] · attempts 2")
    // A finished task is not debt, and clear boxes are still a STATEMENT rather than silence: the
    // push always says where the debt stands, so "no line" can never be confused with "nothing owed".
    expect(note).not.toContain("T7")
    expect(tailNote({ open: [], window: null, debt: { plans: [] } })).toContain("owed: no open plan task")
    // No debt handed in ⇒ no line at all: a caller without plan context keeps the old contract.
    expect(tailNote({ open: [], window: null })).toBe("")
  })

  test("the note is tagged, so its own idempotency check can see it", () => {
    const note = tailNote({ open: [], window: WINDOW })
    expect(note.startsWith(TAIL_NOTE_PREFIX)).toBe(true)
    expect(note).toContain("</compaction-status>")
  })

  test("a folded summary produces no nag", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Effect.runPromise(
          provideInstance(tmp.path)(
            Effect.gen(function* () {
              // A real session: ProjectCheckpointTable has an FK on session_id,
              // so a literal id inserts nothing (SQLITE_CONSTRAINT_FOREIGNKEY).
              const info = yield* (yield* SessionNs.Service).create({})
              const saved = IncrementalCheckpoint.save({
                id: "ckpt-nag-control",
                sessionID: info.id,
                fromMessageID: MessageID.make("msg_from"),
                toMessageID: MessageID.make("msg_to"),
                providerID: ProviderID.make("test"),
                modelID: ModelID.make("test-model"),
                agent: "build_mode",
                body: BODY_WITH_GAPS,
              })

              // Open ⇒ the nag names it.
              const openBefore = IncrementalCheckpoint.listOpen(info.id)
              expect(openBefore.map((s) => s.id)).toEqual([saved.id])
              expect(tailNote({ open: openBefore, window: null })).toContain("summary ckpt-nag-control open")

              // Folded ⇒ the same query drops it, so nothing is nagged about:
              // a line surviving the fold would instruct an action `summaryedit`
              // itself refuses.
              IncrementalCheckpoint.materialize({
                sessionID: info.id,
                ids: [saved.id],
                messageID: MessageID.make("msg_folded"),
              })
              const openAfter = IncrementalCheckpoint.listOpen(info.id)
              expect(openAfter).toEqual([])
              expect(tailNote({ open: openAfter, window: null })).toBe("")
            }).pipe(Effect.provide(SessionNs.defaultLayer)),
          ),
        )
      },
    })
  })
})
