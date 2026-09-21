import { describe, expect, test } from "bun:test"
import { dominantLine, epochOpen, epochOrdinal, extractDominant, extractGoal, extractMessageDominant, parseRange, spineLine } from "@/memory/spine"

/**
 * Two findings from an OUTSIDE call that navigated its own history with this mechanism
 * (2026-09-21): `epoch: 0` was read as a request for an epoch rather than as "not set", and
 * opening an epoch printed the body without the address the descent needs — the caller had to
 * reconstruct the range from the compaction anchor. Both are pinned here.
 */
describe("epochOrdinal", () => {
  test("0 and negatives mean NOT SET — an optional number filled with zero is an absence", () => {
    expect(epochOrdinal(0)).toBeUndefined()
    expect(epochOrdinal(-3)).toBeUndefined()
  })

  test("the ordinal is 1-based, and a fraction matches nobody", () => {
    expect(epochOrdinal(1)).toBe(1)
    expect(epochOrdinal(7)).toBe(7)
    expect(epochOrdinal(2.8)).toBe(2)
    expect(epochOrdinal(Number.NaN)).toBeUndefined()
    expect(epochOrdinal(undefined)).toBeUndefined()
  })
})

describe("epochOpen", () => {
  test("prints the address WITH the body, so the descent needs no reconstruction", () => {
    const text = epochOpen({
      id: "ckpt_1",
      fromMessageID: "msg_a",
      toMessageID: "msg_b",
      body: "## Goal\nx",
    })
    expect(text).toContain("checkpoint_id: `ckpt_1`")
    expect(text).toContain("from_id: `msg_a`  to_id: `msg_b`")
    expect(text).toContain('range: "msg_a..msg_b"')
    // The reviewer's own finding: an older epoch holds conclusions that later epochs refuted.
    expect(text).toContain("a later epoch may have refuted it")
    expect(text.endsWith("## Goal\nx")).toBe(true)
  })
})

// Shaped after a real checkpoint body: the vector block at the head, then the sections.
const BODY = [
  "## Semantic Vector",
  'dominant: "code stricter than its description"',
  "",
  "## Goal",
  "The window opened on the tail of a shipped kernel change",
  "",
  "## Progress",
  "### Done",
  "- something",
].join("\n")

describe("extractDominant", () => {
  test("takes the marker's own line and unquotes it", () => {
    expect(extractDominant(BODY)).toBe("code stricter than its description")
  })

  test("a body with no vector yields nothing rather than a guess", () => {
    expect(extractDominant("## Goal\nsomething")).toBeUndefined()
  })

  test("an empty quoted dominant is not a line", () => {
    expect(extractDominant('dominant: ""')).toBeUndefined()
  })

  test("unquoted and guillemet forms are read too", () => {
    expect(extractDominant("dominant: bare words")).toBe("bare words")
    expect(extractDominant("dominant: \u00ab\u0441\u043b\u043e\u0432\u0430\u00bb")).toBe(
      "\u0441\u043b\u043e\u0432\u0430",
    )
  })

  test("the FIRST marker wins, because the head of the body carries the epoch's own vector", () => {
    const quoted = `dominant: "mine"\n\ntext quoting dominant: "someone else's"`
    expect(extractDominant(quoted)).toBe("mine")
  })
})

describe("extractGoal", () => {
  test("takes the first non-heading line under the heading", () => {
    expect(extractGoal(BODY)).toBe("The window opened on the tail of a shipped kernel change")
  })

  test("a body with no goal yields nothing", () => {
    expect(extractGoal("## Progress\nx")).toBeUndefined()
  })
})

describe("spineLine", () => {
  test("carries the address, because the second query needs it", () => {
    expect(
      spineLine({
        ordinal: 3,
        dominant: "the law left the prompt",
        agent: "build_mode",
        modelID: "deepseek-flash",
        id: "ckpt_1",
        fromMessageID: "msg_a",
        toMessageID: "msg_b",
      }),
    ).toBe('3. "the law left the prompt" \u00b7 build_mode \u00b7 deepseek-flash \u00b7 ckpt_1 \u00b7 msg_a..msg_b')
  })

  test("an epoch without a vector says so instead of borrowing one", () => {
    const line = spineLine({
      ordinal: 1,
      id: "ckpt_1",
      fromMessageID: "msg_a",
      toMessageID: "msg_b",
    })
    expect(line).toBe("1. (no dominant) \u00b7 ckpt_1 \u00b7 msg_a..msg_b")
  })
})

describe("parseRange", () => {
  test("reads the address the spine prints", () => {
    expect(parseRange("msg_a..msg_b")).toEqual({ from: "msg_a", to: "msg_b" })
  })

  test("a single id is a one-message range", () => {
    expect(parseRange("msg_a")).toEqual({ from: "msg_a", to: "msg_a" })
  })

  test("a malformed address returns nothing, so the caller can say so", () => {
    expect(parseRange("msg_a..msg_b..msg_c")).toBeUndefined()
    expect(parseRange("..")).toBeUndefined()
    expect(parseRange("   ")).toBeUndefined()
    expect(parseRange("..msg_b")).toBeUndefined()
  })
})

describe("dominantLine", () => {
  test("carries the part's own address, which is what makes the excerpt re-acquirable", () => {
    expect(
      dominantLine({
        messageIndex: 3510,
        dominant: "the spine is navigable",
        role: "assistant",
        partType: "text",
        messageID: "msg_a",
        partID: "prt_a",
      }),
    ).toBe('#3510 "the spine is navigable" \u00b7 assistant/text \u00b7 msg_a \u00b7 prt_a')
  })

  test("a message without a vector says so instead of borrowing one", () => {
    expect(dominantLine({ messageIndex: 7, messageID: "msg_a", partID: "prt_a" })).toBe(
      "#7 (no dominant) \u00b7 ? \u00b7 msg_a \u00b7 prt_a",
    )
  })
})
