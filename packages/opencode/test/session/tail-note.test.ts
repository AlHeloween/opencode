import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { TAIL_NOTE_PREFIX, owedTasks, statusMarks, statusVector, tailNote, type WindowState } from "../../src/session/compaction"
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
  // The gap list was REPLACED by a count, on a measured reason (compaction.ts:828-832): a summary's gap
  // list names NINE sections, so one unpaid row is already ~340 chars, and six open rows printed the
  // identical gap string six times — the note grew with the pool instead of reporting it. These three
  // assertions were left pointing at the old `summary <id> open · gaps: …` shape by 9e6f6d06 and went
  // red with it; behaviour moved, the suite did not. They are rewritten against the CURRENT render,
  // and the count is asserted with the ADDRESS of the row so a debt line that names no row still fails.
  test("an open summary's debt is COUNTED, ADDRESSED, NAMED, and paired with the tool that can fill it", () => {
    const note = tailNote({ open: [{ id: "ckpt_01", body: BODY_WITH_GAPS }], window: null })
    expect(note).toContain("summaries open: 1 · unpaid: 1 · sections missing in ckpt_01 (3):")
    expect(note).toContain("fill with summaryedit before the fold")
    // THE NAMED PART IS THE POINT, and it is the regression this file now exists to catch. The count
    // alone reads `sections missing per row: 3` and no reader can learn WHICH three: the row render
    // walks the `## ` headings the body HAS, and these three are absent as headings, so they are
    // printed nowhere. A debt line that counts without naming is a silent zero one layer up.
    expect(note).toContain("Next Steps (0/24 chars)")
    expect(note).toContain("Critical Context (0/24 chars)")
    expect(note).toContain("Relevant Files (0/24 chars)")
    // The name list is reported ONCE, not per row: six open rows repeating the identical string six
    // times is what made the note grow with the pool. The bound belongs on the pool, not the reader.
    expect(note.split("fill with summaryedit before the fold").length - 1).toBe(1)
    // A filled section still reads as READ, through the row's own render.
    expect(note).toContain("ckpt_01 165t · Goal: Prove the nag names the deficient sections")
  })

  test("a complete open summary gets a quiet line, without a gap list", () => {
    const note = tailNote({ open: [{ id: "ckpt_02", body: BODY_COMPLETE }], window: null })
    expect(note).toContain("summaries open: 1 · no gaps — fold into the next m* as-is")
    // Not `not.toContain("gaps")` any more: the word is legitimately present in the quiet line's own
    // text, so that assertion would pass for the wrong reason. What must be absent is the NAME LIST
    // and the fill instruction — a complete row earns neither.
    expect(note).not.toContain("chars)")
    expect(note).not.toContain("fill with summaryedit before the fold")
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

  test("the svm line names the manifest of the SAME task the debt line names — or says it is missing", () => {
    // Plan S3. The debt line says WHAT is owed; this one says what that work IS. The property that
    // makes it useful is that both name ONE task: the caller reads `owedTasks(debt)[0]` and reads the
    // manifest of THAT task, so the address is asserted against `owedTasks` — the same function the
    // caller uses — rather than against a literal this test also wrote (a literal would agree with a
    // note that had drifted).
    const debt = {
      plans: [
        {
          file: "plans/2026-09-29_svm-tool-and-master-plan.md",
          lifecycle: "ACTIVE",
          goal_sv: [],
          invariants: [],
          tasks: [
            { id: "S2", title: "a finished task", sv: [], status: "PASS" as const, done_pct: 100, attempts: 0 },
            { id: "S3", title: "the reminder", sv: ["note"], status: "PENDING" as const, done_pct: null, attempts: 0 },
          ],
        },
      ],
    }
    const next = owedTasks(debt)[0]!

    // No manifest yet ⇒ the note SAYS SO. A blank would read as "all good", which is the state this
    // line exists to end: the task is about to be worked on and nobody has written down what it is.
    const absent = tailNote({ open: [], window: null, debt, svm: { plan: next.plan, task: next.task.id, manifest: null } })
    expect(absent).toContain("svm: MISSING for plans/2026-09-29_svm-tool-and-master-plan.md S3")
    // ONE ADDRESS: the task the line describes is the task the debt line points at.
    expect(absent).toContain("next: plans/2026-09-29_svm-tool-and-master-plan.md S3 [PENDING]")

    // With a manifest, the DOMINANT rides the note — the point of the owner's rule: an agent that has
    // never seen this session works in the right key instead of guessing what the task is for.
    const present = tailNote({
      open: [],
      window: null,
      debt,
      svm: {
        plan: next.plan,
        task: next.task.id,
        manifest: { dominant: "the note names the manifest of the task it names", etaTurns: 2, state: "doing" },
      },
    })
    expect(present).toContain(
      "svm: plans/2026-09-29_svm-tool-and-master-plan.md S3 — the note names the manifest of the task it names · eta 2 turn(s) · doing",
    )

    // A caller with no plan context hands in no svm ⇒ the note keeps its old contract, and when there
    // IS a next task the line is printed in BOTH states — never only in the bad one, which would read
    // as noise instead of as a measure.
    expect(tailNote({ open: [], window: null, debt, svm: null })).not.toContain("svm:")
    expect(absent).toContain("owed: 1 open plan task(s)")
  })

  test("the @CURRENT_SV census — the vector rides the TAIL, not the middle of the prefix", () => {
    // Measured 2026-09-22 from the gateway's assembled messages (`per-response/*.md`): the rule sits in
    // the middle of the static prefix and goes quiet as the window grows — obeyed at prompt 352 776
    // tokens, dropped at 389 893 and 498 315. `owed` and `marks` are obeyed because they ride THIS
    // note, next to generation; the vector gets the same seat. ABSENT is an ALERT, not a zero: the
    // coupling watcher cannot link a reply that carries no `md5`.
    const withVector = [
      { role: "user", text: "do the thing" },
      {
        role: "assistant",
        text: "Done.\n\nKeywords: a 0.6, b 0.4\nSemantic dominant: one line.\nmd5: 11111111111111111111111111111111",
      },
    ]
    expect(tailNote({ open: [], window: null, vector: statusVector(withVector) })).toContain(
      "sv: @SV_FORMAT present in the last reply",
    )

    const absent = [
      { role: "user", text: "do the thing" },
      { role: "assistant", text: "Done — and the vector never made it." },
    ]
    const note = tailNote({ open: [], window: null, vector: statusVector(absent) })
    expect(note).toContain("sv: ABSENT in the last reply")
    expect(note).toContain("@CURRENT_SV")

    // A window with no reply yet states THAT, rather than reporting an absence that is not one — the
    // same exclusion `statusMarks` makes: a message with no text is not a reply.
    expect(tailNote({ open: [], window: null, vector: statusVector([{ role: "user", text: "hi" }]) })).toContain(
      "sv: no assistant reply in the window yet",
    )
    // PRESENTATION IS NOT SIGNATURE. The same block is written plainly, in `backticks`, or inside a
    // fence — and a reader that knows ONE form declares the others ABSENT. That is the coupling
    // watcher's own shipped defect (`8×4` labels vs `16+16` vectors, a reader accepting neither), and
    // it fired live the minute this line went into the binary: the reply that CARRIED a vector was
    // read as ABSENT because its block sat in backticks (assembled message, 2026-09-22T21:05:29Z).
    const dressed = [
      { role: "user", text: "do it" },
      {
        role: "assistant",
        text: "Done.\n\n`Keywords: a 0.6, b 0.4`\n`Semantic dominant: one line.`\n`md5: 11111111111111111111111111111111`",
      },
    ]
    expect(statusVector(dressed).present).toBe(true)

    // The tail is what makes this a signature rather than a search: a QUOTED vector is not a carried
    // one, so a citation in the middle must not silence the alert.
    const quoting = [
      { role: "user", text: "do it" },
      {
        role: "assistant",
        text: [
          "The other agent wrote:",
          "",
          "Keywords: x 1.0",
          "Semantic dominant: quoted, not mine.",
          "md5: 00000000000000000000000000000000",
          "",
          "but I carry none of my own. Filler line one.",
          "Filler line two.",
          "Filler line three.",
          "Filler line four.",
          "Filler line five.",
          "Filler line six.",
        ].join("\n"),
      },
    ]
    expect(statusVector(quoting).present).toBe(false)

    // No census handed in ⇒ no line: a caller without window context keeps the old contract.
    expect(tailNote({ open: [], window: null })).toBe("")
  })

  test("the confidence census — the marks are the model's, the count is the MACHINE's", () => {
    // Owner, 2026-09-22: «Сделай это системным алертом… ты сам будешь историю свою читать потом и
    // видеть — где ты был уверен, а где нет… это не эписистемология, это индикатор уверенности за 3
    // копейки.» The marks are two characters and cost nothing; what makes them survive is that a
    // machine COUNTS them, so the census cannot be talked up by a confident tone.
    const census = statusMarks([
      { role: "user", text: "do the thing" },
      { role: "assistant", text: "first ✓✓ and a ✗" },
      { role: "assistant", text: "no marks in this one" },
      { role: "assistant", text: "   " },
      { role: "user", text: "and now?" },
      { role: "assistant", text: "second ✓ ✓✓ ✗" },
    ])
    expect(census).toEqual({ lastConfirmed: 3, lastRefuted: 1, unmarked: 1, replies: 3 })
    // The marks of the LAST reply are what the model can still act on; the window count is what the
    // history reads later to see where the work was confident. One line carries both.
    expect(tailNote({ open: [], window: null, marks: census })).toContain(
      "marks: 3 ✓ · 1 ✗ in the last reply · 1/3 window replies with none",
    )
    // The alert half: a reply with no marks is STATED, never left as a zero the reader interprets.
    // The zero branch names the REQUIRED FORM and not the consequence: 2d3e48dc4c changed the string
    // and this assertion with it — the previous one still read `unmarked claims read as CONFIRMED`,
    // and this file was not in the run, so the change shipped red.
    const silent = statusMarks([{ role: "assistant", text: "everything is fine, no marks here" }])
    expect(tailNote({ open: [], window: null, marks: silent })).toContain(
      "marks: NONE in the last reply — REQUIRED FORM:",
    )
    // The census stays on the same line, so the alert and the count cannot drift apart.
    expect(tailNote({ open: [], window: null, marks: silent })).toContain("1/1 window replies with none")
    // ONE CARRIER PER FACT, pinned. This line used to end `Unmarked claims read as CONFIRMED.` — a
    // restatement of what silence MEANS, which belongs to the prefix and nowhere else. Under the
    // installed kernel (2026-09-27) those same words changed meaning: `reasoning_prompt.txt:405` now
    // reads «…that gap is the DEFECT», so a line that once carried an instruction began carrying a
    // diagnosis, and a status line is read as an instruction. The fix was never a wording; it was to
    // delete the second carrier. This assertion is what stops it coming back, and it is written as a
    // NEGATIVE because the failure mode is a re-added sentence nobody notices.
    expect(tailNote({ open: [], window: null, marks: silent })).not.toContain("Unmarked claims read as CONFIRMED")
    // Nothing to count yet is its own sentence — NOT the same reading as "the model marked nothing".
    expect(
      tailNote({
        open: [],
        window: null,
        marks: { lastConfirmed: 0, lastRefuted: 0, unmarked: 0, replies: 0 },
      }),
    ).toContain("marks: no assistant reply in the window yet")
    // A message with no text is not a reply: there is nothing in it to mark, so it is no failure.
    expect(statusMarks([{ role: "assistant", text: "   " }]).replies).toBe(0)
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
              // Open ⇒ the debt line names it, by address. The old assertion read
              // `summary ckpt-nag-control open`, a shape 9e6f6d06 replaced; what survives is the row's
              // id inside the debt line, so that is what is pinned.
              expect(tailNote({ open: openBefore, window: null })).toContain("unpaid: 1 · sections missing in ckpt-nag-control (3):")
              expect(tailNote({ open: openBefore, window: null })).toContain("ckpt-nag-control")

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
