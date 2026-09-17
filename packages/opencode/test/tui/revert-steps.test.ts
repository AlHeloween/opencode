import { describe, expect, test } from "bun:test"
import { revertSteps } from "@/cli/cmd/tui/util/revert-steps"

const user = (id: string) => ({ id, role: "user" })
const assistant = (id: string) => ({ id, role: "assistant" })

// A session as the transcript holds it: ascending ids, roles interleaved.
const session = [user("msg_01"), assistant("msg_02"), user("msg_03"), assistant("msg_04"), user("msg_05")]

describe("tui revert steps", () => {
  test("with no revert active every user message is still reachable backwards", () => {
    expect(revertSteps({ messages: session, revert: null })).toEqual({ back: 3, forward: 0 })
    expect(revertSteps({ messages: session })).toEqual({ back: 3, forward: 0 })
  })

  test("the cursor counts only user messages strictly behind it", () => {
    // Mirrors `session.undo`, which targets the last user message before the
    // cursor — the cursor's own message is already undone.
    expect(revertSteps({ messages: session, revert: { messageID: "msg_05" } }).back).toBe(2)
    expect(revertSteps({ messages: session, revert: { messageID: "msg_03" } }).back).toBe(1)
    expect(revertSteps({ messages: session, revert: { messageID: "msg_01" } }).back).toBe(0)
  })

  test("an active revert always has at least one redo", () => {
    // `op_id` is the immediate forward leaf, so a bare revert with an empty
    // stack is still one step forward — reporting 0 would grey out the arrow
    // that actually works.
    expect(revertSteps({ messages: session, revert: { messageID: "msg_05" } }).forward).toBe(1)
    expect(revertSteps({ messages: session, revert: { messageID: "msg_05", redo_stack: [] } }).forward).toBe(1)
  })

  test("each redo frame is one more step forward", () => {
    const revert = { messageID: "msg_01", redo_stack: [{}, {}, {}] }
    expect(revertSteps({ messages: session, revert })).toEqual({ back: 0, forward: 4 })
  })

  test("assistant messages are not undo steps", () => {
    expect(revertSteps({ messages: [assistant("msg_01"), assistant("msg_02")], revert: null }).back).toBe(0)
  })

  test("an empty session offers no steps in either direction", () => {
    expect(revertSteps({ messages: [], revert: null })).toEqual({ back: 0, forward: 0 })
  })

  test("walking the sequence conserves the total number of steps", () => {
    // undo → undo → undo. Each undo moves the cursor back one user message AND
    // pushes the position it left onto the redo stack, so back+forward must
    // stay at the number of user messages the whole way down. If it drifts,
    // one arrow is lying about where the cursor can go.
    const walk = [
      { messageID: "msg_05", redo_stack: [] },
      { messageID: "msg_03", redo_stack: [{ messageID: "msg_05" }] },
      { messageID: "msg_01", redo_stack: [{ messageID: "msg_03" }, { messageID: "msg_05" }] },
    ]

    expect(walk.map((revert) => revertSteps({ messages: session, revert }))).toEqual([
      { back: 2, forward: 1 },
      { back: 1, forward: 2 },
      { back: 0, forward: 3 },
    ])

    // The conserved quantity, stated directly.
    for (const revert of walk) {
      const steps = revertSteps({ messages: session, revert })
      expect(steps.back + steps.forward).toBe(3)
    }
  })
})
