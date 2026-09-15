import { describe, expect, test } from "bun:test"
import { finalizeReasoning } from "@/session/processor"
import { StringBuilder } from "@/util/string-builder"
import type { MessageV2 } from "@/session/message-v2"

/**
 * The reasoning-persistence contract, pinned.
 *
 * Reasoning text reaches the database exactly twice: on `reasoning-end`
 * (`finishReasoning`) and on stream cleanup (`finalizeReasoning`). The deltas
 * in between are `BusEvent`s only — never persisted, never replayable. So an
 * interrupted turn has ONE chance to keep its thought, and it is this function.
 *
 * Both records are keyed by the provider's reasoning STREAM id. The part's own
 * `PartID` is a different value entirely, and looking a builder up by it
 * returns undefined silently — no type error, no throw, just an empty thought
 * written over a real one. That is what shipped: on 2026-09-15 a 26-second
 * burst of ~5,500 deltas was aborted and stored as an 81-byte row.
 */
describe("finalizeReasoning — an interrupted thought survives", () => {
  const NOW = 1_700_000_000_000

  function fixture(streamID: string, partID: string, streamed: string) {
    const builder = new StringBuilder()
    builder.append(streamed)
    return {
      map: {
        [streamID]: {
          id: partID,
          messageID: "msg_test",
          sessionID: "ses_test",
          type: "reasoning",
          text: "",
          time: { start: NOW - 26_000 },
        } as MessageV2.ReasoningPart,
      },
      builders: { [streamID]: builder },
    }
  }

  test("the builder is found by stream id, not by part id", () => {
    // The two ids differ — that difference is the whole bug.
    const { map, builders } = fixture("0", "prt_0a37ab162001UUfEy6K8MS2T9C", "thought so far")
    expect(finalizeReasoning(map, builders, NOW)[0].text).toBe("thought so far")
  })

  test("a part id never collides into the builder table", () => {
    // Guards the inverse mistake: keying the builders by part id would make
    // the buggy lookup pass and this assertion fail.
    const { builders } = fixture("0", "prt_abc", "x")
    expect(builders["prt_abc"]).toBeUndefined()
  })

  test("every open stream is flushed, not just the first", () => {
    const a = new StringBuilder()
    a.append("first")
    const b = new StringBuilder()
    b.append("second")
    const map = {
      "0": { id: "prt_a", text: "", time: { start: NOW } } as MessageV2.ReasoningPart,
      "1": { id: "prt_b", text: "", time: { start: NOW } } as MessageV2.ReasoningPart,
    }
    expect(finalizeReasoning(map, { "0": a, "1": b }, NOW).map((p) => p.text)).toEqual(["first", "second"])
  })

  test("a stream with no builder keeps whatever text the part already had", () => {
    // `finishReasoning` deletes the builder after writing the text back, so a
    // part finalized earlier in the same turn must not be blanked here.
    const map = {
      "0": { id: "prt_a", text: "already finished", time: { start: NOW } } as MessageV2.ReasoningPart,
    }
    expect(finalizeReasoning(map, {}, NOW)[0].text).toBe("already finished")
  })

  test("an empty builder does not resurrect stale text", () => {
    const map = { "0": { id: "prt_a", text: "stale", time: { start: NOW } } as MessageV2.ReasoningPart }
    expect(finalizeReasoning(map, { "0": new StringBuilder() }, NOW)[0].text).toBe("")
  })

  test("the part is closed with an end time and keeps its start", () => {
    const { map, builders } = fixture("0", "prt_a", "text")
    expect(finalizeReasoning(map, builders, NOW)[0].time).toEqual({ start: NOW - 26_000, end: NOW })
  })

  test("a part already closed by finishReasoning keeps its own end time", () => {
    // Cleanup runs once for the whole stream. A reasoning block that ended in
    // second 2 of a 26-second turn must not be reported as 26 seconds long.
    const map = {
      "0": { id: "prt_a", text: "done", time: { start: NOW - 26_000, end: NOW - 24_000 } } as MessageV2.ReasoningPart,
    }
    expect(finalizeReasoning(map, {}, NOW)[0].time).toEqual({ start: NOW - 26_000, end: NOW - 24_000 })
  })

  test("nothing open means nothing written", () => {
    expect(finalizeReasoning({}, {}, NOW)).toEqual([])
  })
})
