/**
 * The summary block is the handle the NEXT cycle reads. It must carry the LEGEND, never the patch
 * bodies: a block that inlines diffs replaces the intention with code churn — the measured way a
 * window's goals are lost (owner, 2026-09-21: «умник решил проза не нужна и оставил только диффы»;
 * the incident is recorded in `plans/to_be_confirmed/2026-09-21_mstar-order-and-summary-restore.md`).
 *
 * Two pins, and both must be able to FAIL:
 *   1. the legend renders counts + addresses and NO `@@` / `+++` / ```diff fence — a fixture WITH
 *      patch bodies proves the bodies are dropped rather than merely absent;
 *   2. the summary range diff names its END anchor in the call — pinned by FORM (the call, not a
 *      word in a comment), the same discipline `fill-layers.test.ts` uses, because a comment
 *      survives a broken implementation and a call does not.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { buildGoalLines, buildMessageStar, buildTableOfContents, changedLines, diagnoseSummaryGaps, renderFileDiffLegend, renderSummaryBlock } from "../../src/session/compaction"
import type { MessageV2 } from "../../src/session/message-v2"
import { extractKeywords, extractVectorChain } from "../../src/memory/spine"
import type { PlanStatePayload } from "../../src/util/plan-status"

describe("summary block shape", () => {
  test("the legend carries counts and addresses, and drops patch bodies", () => {
    // The fixture DELIBERATELY carries bodies: if the renderer stopped filtering them, this test
    // would see `@@` where it must not.
    const diffs = [
      {
        file: "src/solver/forward.ts",
        additions: 120,
        deletions: 8,
        status: "modified",
        patch: "@@ -1,3 +1,4 @@\n--- a/src/solver/forward.ts\n+++ b/src/solver/forward.ts\n+const step = 1",
      },
      {
        file: "src/solver/inverse.ts",
        additions: 28,
        deletions: 2,
        status: "added",
        patch: "@@ -0,0 +1,3 @@\n+export const solve = () => 0",
      },
    ]

    const legend = renderFileDiffLegend(diffs, true)

    expect(legend).toContain("files=2")
    expect(legend).toContain("additions=148")
    expect(legend).toContain("deletions=10")
    // THE CONTRACT (owner, 2026-09-22: «точный путь к файлу и номера строк … типа 10: хххх / 11: yyyy»):
    // the exact path leads, then the CHANGED LINES each with its own number. An addition carries its
    // number in the NEW file; a removal carries its position in the OLD one and is marked `−`.
    expect(legend).toContain("src/solver/forward.ts (modified +120/-8)")
    // The `--- `/`+++ ` headers in the fixture sit AFTER the hunk — non-canonical on purpose. They
    // are skipped wherever they land, so they must NOT shift the numbering: the addition below is the
    // change at new line 1, which is what the hunk declares.
    expect(legend).toContain("1: const step = 1")
    expect(legend).toContain("src/solver/inverse.ts (added +28/-2)")
    expect(legend).toContain("1: export const solve = () => 0")
    expect(legend).toContain("sessionread")
    // The reader's next move is named, in the block, once — not left to be remembered.
    expect(legend).toContain("Use codegraph for precise understanding of the task.")

    // The changed lines, never the hunks: no hunk header, no file header, no fence.
    expect(legend.includes("@@")).toBe(false)
    expect(legend.includes("+++")).toBe(false)
    expect(legend.includes("```diff")).toBe(false)
  })

  test("a file whose patch was not kept shows its size and NO lines — the renderer never invents an address", () => {
    const legend = renderFileDiffLegend(
      [
        { file: "src/kept.ts", additions: 2, deletions: 0, patch: "@@ -5,0 +6,2 @@\n+two lines\n+more" },
        { file: "src/dropped.ts", additions: 4, deletions: 1 },
      ],
      false,
    )
    expect(legend).toContain("src/kept.ts (modified +2/-0)")
    expect(legend).toContain("6: two lines")
    expect(legend).toContain("7: more")
    // No patch ⇒ no lines anywhere for that file, and its size is still stated.
    expect(legend).toContain("src/dropped.ts (modified +4/-1)")
    expect(legend).not.toContain("dropped" + "\n" + "      ")
  })

  test("a removal is addressed by the position it HAD, and the cap is named", () => {
    // A pure deletion: nothing exists in the new file, so an address in the new file would be a lie.
    const legend = renderFileDiffLegend(
      [{ file: "src/gone.ts", additions: 0, deletions: 1, patch: "@@ -9,1 +9,0 @@\n-only line" }],
      false,
    )
    expect(legend).toContain("9: −only line")
    // The per-file cap is a named trim, never a silent cut.
    const long = Array.from({ length: 40 }, (_, i) => `+line ${i}`).join("\n")
    expect(renderFileDiffLegend([{ file: "src/long.ts", additions: 40, deletions: 0, patch: `@@ -1,0 +1,40 @@\n${long}` }], false)).toContain(
      "… +28 more changed line(s) in this file",
    )
  })

  test("the comment above a group is captured — the owner's ask: numbered lines that are READABLE", () => {
    // «если ты сможешь захватить коммент над группой линий, то будет вообще шедеврально» (2026-09-22).
    // A numbered line without its comment is an address; with it, it is something the next window can
    // act on without opening the file. Two groups, so the cap and the per-group boundary both show.
    const patch = [
      "@@ -10,7 +10,8 @@",
      " // the ledger's debt, counted from the durable row",
      " // (second line of the same comment)",
      " const claims = []",
      "+const more = 1",
      " ",
      " // a second group, miles away",
      "+const other = 2",
    ].join("\n")
    const { lines } = changedLines(patch)
    expect(lines).toEqual([
      "10: // the ledger's debt, counted from the durable row",
      "11: // (second line of the same comment)",
      "13: const more = 1",
      "15: // a second group, miles away",
      "16: const other = 2",
    ])
    // A group with no comment above it gets no invented header: the numbers speak alone.
    expect(changedLines("@@ -1,1 +1,2 @@\n+only line").lines).toEqual(["1: only line"])
  })

  test("the legend is capped by ADDRESSES, and the cap is named as a floor", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      file: `src/gen/file${i}.ts`,
      additions: 1,
      deletions: 0,
    }))

    const legend = renderFileDiffLegend(many, false)

    expect(legend).toContain("files=23")
    expect(legend).toContain("+3 more")
    expect(legend.includes("@@")).toBe(false)
    // No patches in this fixture ⇒ no ranges anywhere, and the hint still closes the block.
    expect(legend).not.toContain(".ts:")
    expect(legend).toContain("Use codegraph for precise understanding of the task.")
  })

  test("FALSIFIER — the range diff names its END anchor in the call", () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "../../src/session/summary.ts"), "utf8")
    const start = source.indexOf("const rangeDiffs = Effect.fn(")
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf("const enrichRange", start))
    expect(body).toContain("summaryRangeEndHash(")
    expect(body).toContain("diffFull(from, to)")
  })

  test("FALSIFIER — the patch-body dump is gone from the summary renderer", () => {
    const source = fs.readFileSync(path.join(import.meta.dir, "../../src/session/compaction.ts"), "utf8")
    // The exact shape that produced the dump: a 40-line slice of the patch inside a diff fence.
    expect(source.includes("diff.patch.trim().split(")).toBe(false)
    expect(source.includes("```diff`")).toBe(false)
  })

  test("FALSIFIER — the intention LEADS the summary block, the Exact machinery follows", () => {
    const block = renderSummaryBlock({
      sessionID: "ses_shape",
      index: 0,
      s: {
        id: "ckpt_shape",
        text: "## Goal\nRestore the summaries so the next cycle reads intention, not churn.\n",
        diffs: [
          {
            file: "src/solver/forward.ts",
            additions: 120,
            deletions: 8,
            status: "modified",
            // Carried on purpose: the block must read as intention + legend even when the entry
            // still HAS a body — otherwise the pin would only prove the body was never there.
            patch: "@@ -1,2 +1,3 @@\n--- a/src/solver/forward.ts\n+++ b/src/solver/forward.ts\n+const step = 1",
          },
        ],
      },
    })

    const goalAt = block.indexOf("## Goal")
    const legendAt = block.indexOf("files=1")
    expect(goalAt).toBeGreaterThan(-1)
    expect(legendAt).toBeGreaterThan(-1)
    // Why the window existed comes first; the system handles are still all here, just after it.
    expect(goalAt).toBeLessThan(legendAt)
    expect(block.includes("@@")).toBe(false)
  })

  test("FALSIFIER — the fading links sit at the END of memory, never above it", () => {
    const star = buildMessageStar({
      sessionID: "ses_shape",
      summaries: [{ id: "s1", text: '## Semantic Vector\ndominant: "shape pin"' }],
      recent: [],
      memory: "MEMORY-MARKER: the durable block",
      priorMessageStarId: "msg_prior_star",
    })

    const memoryAt = star.indexOf("MEMORY-MARKER: the durable block")
    const linkAt = star.indexOf("Prior message*")
    expect(memoryAt).toBeGreaterThan(-1)
    expect(linkAt).toBeGreaterThan(-1)
    // Long-term memory first (§2); a pointer to the older star may not be hoisted above it.
    expect(memoryAt).toBeLessThan(linkAt)
  })

  test("FALSIFIER — intentions WITHOUT the plan are a gapped summary", () => {
    // «Чёткие намерения с планами» (owner, 2026-09-21): the plan is a section of its own, not a
    // sentence inside Goal or Next Steps — riding inside another section is how it went missing.
    const body = (plan: string) =>
      [
        "## Semantic Vector",
        'dominant: "shape pin"',
        "",
        "## Goal",
        "Restore the summaries so the next cycle reads the intention together with the plan it served.",
        "",
        "## Plan",
        plan,
        "",
        "## Constraints & Preferences",
        "- none beyond the standing project rules",
        "",
        "## Current state",
        "### Done",
        "- the block leads with the intention",
        "### In Progress",
        "- the fold rehearsal",
        "### Blocked",
        "- nothing",
        "",
        "## Key decisions",
        "- keep the `Prior message*` label so its existing pin keeps holding",
        "",
        "## Next Steps",
        "- run the fold rehearsal",
        "",
        "## Critical Context",
        "- the star renders once per boundary and is stored as a message",
        "",
        "## Relevant Files",
        "- packages/opencode/src/session/compaction.ts: the renderer",
      ].join("\n")

    const planned = diagnoseSummaryGaps(body("1. reorder the star (compaction.ts:1377)"))
    const unplanned = diagnoseSummaryGaps(body(""))

    // Positive control: a body that CARRIES the plan must not be nagged about it.
    expect(planned.some((g) => g.startsWith("Plan "))).toBe(false)
    expect(unplanned.some((g) => g.startsWith("Plan "))).toBe(true)
  })

  test("FALSIFIER — the table of contents is READ from the rows, never generated", () => {
    const asMessage = (id: string, role: "user" | "assistant", text: string) =>
      ({
        info: { id, role },
        parts: [{ id: `${id}-p1`, type: "text", text }],
      }) as unknown as MessageV2.WithParts
    const entries = [
      { message: asMessage("msg_a", "assistant", 'did the first thing\n\ndominant: "first thing"'), position: 1 },
      { message: asMessage("msg_b", "user", "no dominant anywhere in this one"), position: 2 },
      { message: asMessage("msg_c", "assistant", 'did the second thing\n\ndominant: "second thing"'), position: 3 },
    ]

    const toc = buildTableOfContents(entries)
    const text = toc.lines.join("\n")

    // One line per message THAT CARRIES a dominant — a row without one contributes nothing, which
    // is a smaller error than an invented line.
    expect(toc.lines).toHaveLength(2)
    expect(text).toContain("first thing")
    expect(text).toContain("second thing")
    // The address travels with the line: the position, the message id and the part that carries it.
    expect(toc.lines[0]).toContain("#1")
    expect(toc.lines[0]).toContain("msg_a")
    expect(toc.lines[0]).toContain("msg_a-p1")

    // Rows kept verbatim in the tail are skipped — the window already holds them as themselves.
    const skipped = buildTableOfContents(entries, { skipIds: new Set(["msg_a"]) })
    expect(skipped.lines.join("\n")).not.toContain("first thing")

    // The cap is a FLOOR with a name: a trimmed table says so, and the newest lines survive.
    const many = Array.from({ length: 40 }, (_, i) => ({
      message: asMessage(`msg_${i}`, "assistant", `work ${i}\n\ndominant: "epoch ${i} of a long session"`),
      position: i + 1,
    }))
    const capped = buildTableOfContents(many, { maxChars: 400 })
    expect(capped.trimmed).toBeGreaterThan(0)
    expect(capped.lines[0]).toContain("trimmed")
    expect(capped.lines.at(-1)).toContain("epoch 39")
  })

  test("FALSIFIER — the goal is READ: the plan's intention and the owner's own words", () => {
    const planState: PlanStatePayload = {
      plans: [
        {
          file: "plans/to_be_confirmed/2026-09-21_mstar-order-and-summary-restore.md",
          intention: { from_state: "the fold loses the why", to_state: "the fold reads it" },
          goal_sv: ["fold", "intention", "goal"],
          invariants: [],
          tasks: [],
        },
      ],
    }

    const lines = buildGoalLines({
      planState,
      window: {
        messageID: "msg_opening",
        position: 7,
        text: "Fix the fold.\nSecond line.\nThird line.\nFourth line that must be cut.",
      },
    })
    const text = lines.join("\n")

    // The plan's intention, with the file it came from — an address, not a paraphrase.
    expect(text).toContain("plans/to_be_confirmed/2026-09-21_mstar-order-and-summary-restore.md")
    expect(text).toContain("the fold loses the why -> the fold reads it")
    expect(text).toContain("fold, intention, goal")
    // The owner's words, quoted verbatim, with the message they came from.
    expect(text).toContain("#7")
    expect(text).toContain("msg_opening")
    expect(text).toContain('"Fix the fold. / Second line. / Third line.')
    // Bounded, and the cut is NAMED — a shortened quote is never mistaken for the whole request.
    expect(text).not.toContain("Fourth line")
    expect(text).toContain("(cut")

    // No carrier ⇒ the goal is UNKNOWN and says so. It is a record, never an invented line.
    expect(buildGoalLines({}).join("\n")).toContain("goal: Unknown")
  })

  test("FALSIFIER — weighted terms are read literally: left to right, stop at prose, never repaired", () => {
    // The shapes are real traffic from the probe (1134 carriers): a multi-word term, a trailing
    // period, and the model continuing to THINK after its own vector.
    expect(extractKeywords("Keywords: provider auth 0.30, API key 0.20, gateway 0.50")).toEqual([
      { term: "provider auth", weight: 0.3 },
      { term: "API key", weight: 0.2 },
      { term: "gateway", weight: 0.5 },
    ])
    expect(extractKeywords("Keywords: fold 0.40, memory 0.30, undo 0.30.")?.map((t) => t.term)).toEqual([
      "fold",
      "memory",
      "undo",
    ])

    // The STOP: what follows the vector is prose, not a term — and what was read is NOT repaired.
    const stopped = extractKeywords("Keywords: fold 0.40, wait — weights must sum 1.0. Keep it simple")
    expect(stopped).toEqual([{ term: "fold", weight: 0.4 }])
    expect(stopped!.reduce((sum, entry) => sum + entry.weight, 0)).toBe(0.4)

    // The LAST marker wins: an answer may quote the format before writing its own vector.
    const quoted = extractKeywords(
      "The format is `Keywords: topic1 0.35, topic2 0.65`.\n\nKeywords: real-axis 0.75, second 0.25",
    )
    expect(quoted?.map((t) => t.term)).toEqual(["real-axis", "second"])
  })

  test("FALSIFIER — the table of contents carries each epoch's topic axis and the window's", () => {
    const asMessage = (id: string, text: string) =>
      ({
        info: { id, role: "assistant" },
        parts: [{ id: `${id}-p1`, type: "text", text }],
      }) as unknown as MessageV2.WithParts

    const toc = buildTableOfContents(
      [
        {
          message: asMessage(
            "msg_1",
            'one\n\ndominant: "first epoch"\n\nKeywords: fold 0.50, memory 0.30, keywords 0.20',
          ),
          position: 1,
        },
        {
          message: asMessage(
            "msg_2",
            'two\n\ndominant: "second epoch"\n\nKeywords: memory 0.60, fold 0.40',
          ),
          position: 2,
        },
        { message: asMessage("msg_3", 'three\n\ndominant: "no vector beyond it"'), position: 3 },
      ],
      { maxChars: 4_000 },
    )
    const text = toc.lines.join("\n")

    // The axis rides the line, three terms at most, WITH the weights as written.
    expect(text).toContain("kw: fold 0.5, memory 0.3, keywords 0.2")
    // A message whose vector carries no Keywords line renders no axis — not an empty `kw:`.
    expect(text).toContain('no vector beyond it" · assistant/text')
    // The window's axis is a COUNT of carriers: fold in 2 vectors, memory in 2, keywords in 1.
    expect(toc.topics).toContain("fold×2")
    expect(toc.topics).toContain("memory×2")
    expect(toc.topics).toContain("keywords×1")
    // …and it says what the number MEANS, so a count is never read as a weight.
    expect(toc.topics).toContain("own top-3")
  })

  test("FALSIFIER — a DECLARED chain break is marked; a linked pair is not", () => {
    const asMessage = (id: string, text: string) =>
      ({
        info: { id, role: "assistant" },
        parts: [{ id: `${id}-p1`, type: "text", text }],
      }) as unknown as MessageV2.WithParts
    const a = "a".repeat(32)
    const b = "b".repeat(32)
    const zero = "0".repeat(32)
    const vector = (md5: string, prev: string) =>
      `work\n\ndominant: "an epoch"\n\nmd5: ${md5}\nprev-md5: ${prev}\nparent-goal-md5: ${zero}`
    // LINKED: the second message declares the first message's own hash. Nothing is marked, and the
    // chain START declares the empty hash — the absence of a predecessor is not a break.
    const linked = buildTableOfContents([
      { message: asMessage("msg_1", vector(a, zero)), position: 1 },
      { message: asMessage("msg_2", vector(b, a)), position: 2 },
    ])
    expect(linked.chainBreaks).toBe(0)
    expect(linked.lines.join("\n")).not.toContain("chain break")

    // BROKEN: the second message points at a predecessor hash the first one does not carry. The
    // marker lands on the message that DECLARED it, with that message's address.
    const broken = buildTableOfContents([
      { message: asMessage("msg_1", vector(a, zero)), position: 1 },
      { message: asMessage("msg_2", vector(b, b)), position: 2 },
    ])
    expect(broken.chainBreaks).toBe(1)
    expect(broken.lines[1]).toContain("⚠ chain break")
    expect(broken.lines[1]).toContain("msg_2")
    expect(broken.lines[0]).not.toContain("chain break")

    // SILENT: neither side declares a chain ⇒ UNKNOWN, and unknown is not a break.
    const silent = buildTableOfContents([
      { message: asMessage("msg_1", 'dominant: "no chain here"'), position: 1 },
      { message: asMessage("msg_2", 'dominant: "still none"'), position: 2 },
    ])
    expect(silent.chainBreaks).toBe(0)
    expect(silent.lines.join("\n")).not.toContain("chain break")
  })

  test("FALSIFIER — the SPACED hash form is read too, and normalised to the canonical one", () => {
    // Measured on this session: our own vectors write `md5: 16hex 16hex` (a space inside), while the
    // canonical form is 32 hex with no other character. Because the reader only knew the canonical
    // form, those rows' own md5 was unreadable and the chain marker did nothing on them — the defect
    // was in the WRITER's habit, and it silently disabled a reader built the same day.
    expect(extractVectorChain("md5: 4d8b1c07f39a256e 0c7e5a91b3f04d82").md5).toBe(
      "4d8b1c07f39a256e0c7e5a91b3f04d82",
    )
    expect(extractVectorChain("md5: 4d8b1c07f39a256e0c7e5a91b3f04d82").md5).toBe(
      "4d8b1c07f39a256e0c7e5a91b3f04d82",
    )
    // Both spellings of the SAME hash must compare equal, or a chain would look broken between a
    // message written in one form and the next written in the other.
    const asMessage = (id: string, text: string) =>
      ({
        info: { id, role: "assistant" },
        parts: [{ id: `${id}-p1`, type: "text", text }],
      }) as unknown as MessageV2.WithParts
    const spaced = buildTableOfContents([
      { message: asMessage("msg_1", "work\n\nmd5: aaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaa"), position: 1 },
      {
        message: asMessage(
          "msg_2",
          "work\n\nmd5: bbbbbbbbbbbbbbbb bbbbbbbbbbbbbbbb\nprev-md5: aaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaa",
        ),
        position: 2,
      },
    ])
    expect(spaced.chainBreaks).toBe(0)
    expect(spaced.lines.join("\n")).not.toContain("chain break")
  })
})
