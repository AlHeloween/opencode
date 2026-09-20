import { describe, expect, test } from "bun:test"
import { dominantLine, extractDominant, extractGoal, extractMessageDominant, parseRange, spineLine } from "@/memory/spine"

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
