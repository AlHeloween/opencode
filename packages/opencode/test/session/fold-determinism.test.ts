/**
 * The fold's render is DETERMINISTIC: the same rows must produce the same bytes twice.
 *
 * That was the one half of the plan's §0 table-of-contents box left unproven — the other half (every
 * line carries its address) is pinned next door. Why it needs a pin at all: the head is assembled
 * from four readers now — memory from disk, plan state from the plan files, the rows' own dominants
 * and weighted terms, and the tail — and ANY of them could leak a clock, a Set iteration order or a
 * default that differs between calls. Nothing about "the same rows" is obvious once four readers
 * feed one string.
 *
 * The equality is checked WITH a control: the render must also change when an input changes, or the
 * pin would be proving that a constant equals itself.
 */
import { describe, expect, test } from "bun:test"
import { buildMessageStar } from "../../src/session/compaction"
import type { MessageV2 } from "../../src/session/message-v2"

const asMessage = (id: string, text: string) =>
  ({
    info: { id, role: "assistant" },
    parts: [{ id: `${id}-p1`, type: "text", text }],
  }) as unknown as MessageV2.WithParts

const render = (memory: string) =>
  buildMessageStar({
    sessionID: "ses_determinism",
    summaries: [],
    recent: [
      asMessage("msg_1", 'first\ndominant: "one"\nKeywords: fold 0.6, head 0.4'),
      asMessage("msg_2", 'second\ndominant: "two"\nKeywords: memory 0.7, tail 0.3'),
    ],
    toc: [
      '#1 "one" · kw: fold 0.6, head 0.4 · assistant/text · msg_1 · prt_1',
      '#2 "two" · kw: memory 0.7, tail 0.3 · assistant/text · msg_2 · prt_2',
    ],
    topics: "fold×1, head×1, memory×1, tail×1",
    goal: ['goal (window, owner\'s words — #1 `msg_1`): "do it"'],
    planState: {
      plans: [
        {
          file: "plans/2026-09-21_x.md",
          lifecycle: "ACTIVE",
          intention: { from_state: "a", to_state: "b" },
          goal_sv: [],
          invariants: [],
          tasks: [
            {
              id: "T7",
              title: "an open task",
              sv: ["head"],
              status: "PENDING" as const,
              done_pct: null,
              attempts: 1,
            },
          ],
        },
      ],
    },
    recentStartOffset: 1,
    memory,
  })

describe("the fold's render", () => {
  test("the same rows render byte-for-byte the same twice — and change when an input changes", () => {
    const first = render("CRITERION: read, never generate.")
    expect(render("CRITERION: read, never generate.")).toBe(first)

    // The control: same function, same shape, ONE input moved. Without this the equality above would
    // be satisfied by a function that returns a constant — which is the failure a determinism pin is
    // most likely to hide.
    const changed = render("CRITERION: read, never generate. CHANGED.")
    expect(changed).not.toBe(first)
    expect(changed).toContain("CHANGED")

    // And the head really is assembled from the four readers, not from one of them: the plan state,
    // the goal, the table of contents and the memory all have to be visible in the same string.
    for (const block of ["<memory>", "--- Goal ---", "--- Plan state", "--- Table of contents", "--- Window topics"]) {
      expect(first).toContain(block)
    }
  })
})
