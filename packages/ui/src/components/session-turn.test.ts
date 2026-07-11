import { describe, expect, test } from "bun:test"

/**
 * Tests for SessionTurn pending detection logic.
 *
 * The production code in session-turn.tsx filters pending assistant messages
 * by sessionID to avoid matching messages from child/sub-agent sessions.
 *
 * We test the filtering logic in isolation here.
 */

interface AssistantMessage {
  id: string
  sessionID: string
  role: "assistant"
  time: { completed?: number }
  parentID?: string
}

interface UserMessage {
  id: string
  sessionID: string
  role: "user"
  time: { created: number }
}

type Message = AssistantMessage | UserMessage

/**
 * Simulates the fixed pending detection logic from session-turn.tsx.
 * Returns the first uncompleted assistant message in the given session,
 * filtering out messages from OTHER sessions.
 */
function findPendingInSession(messages: Message[], sessionID: string): AssistantMessage | undefined {
  return messages.findLast(
    (item): item is AssistantMessage =>
      item.role === "assistant" &&
      item.sessionID === sessionID &&
      typeof item.time.completed !== "number",
  )
}

describe("SessionTurn pending detection", () => {
  test("finds pending message in same session", () => {
    const messages: Message[] = [
      { id: "u1", sessionID: "s1", role: "user", time: { created: 100 } },
      { id: "a1", sessionID: "s1", role: "assistant", time: {} }, // pending (no completed)
    ]
    const result = findPendingInSession(messages, "s1")
    expect(result?.id).toBe("a1")
  })

  test("ignores pending messages from other sessions", () => {
    const messages: Message[] = [
      // This pending message belongs to session s2
      { id: "a1", sessionID: "s2", role: "assistant", time: {} }, // pending
    ]
    const result = findPendingInSession(messages, "s1")
    expect(result).toBeUndefined()
  })

  test("does not match completed messages", () => {
    const messages: Message[] = [
      { id: "a1", sessionID: "s1", role: "assistant", time: { completed: 200 } },
    ]
    const result = findPendingInSession(messages, "s1")
    expect(result).toBeUndefined()
  })

  test("prefers pending over completed in same session", () => {
    const messages: Message[] = [
      { id: "a1", sessionID: "s1", role: "assistant", time: { completed: 200 } },
      { id: "a2", sessionID: "s1", role: "assistant", time: {} }, // pending
    ]
    const result = findPendingInSession(messages, "s1")
    expect(result?.id).toBe("a2")
  })

  test("findLast returns the last pending", () => {
    const messages: Message[] = [
      { id: "a1", sessionID: "s1", role: "assistant", time: {} }, // pending
      { id: "a2", sessionID: "s1", role: "assistant", time: {} }, // pending
    ]
    const result = findPendingInSession(messages, "s1")
    expect(result?.id).toBe("a2")
  })

  test("mixed sessions: only returns pending from target session", () => {
    const messages: Message[] = [
      { id: "u1", sessionID: "s1", role: "user", time: { created: 100 } },
      { id: "a1", sessionID: "s2", role: "assistant", time: {} }, // pending, different session
      { id: "a2", sessionID: "s1", role: "assistant", time: {} }, // pending, target session
    ]
    const result = findPendingInSession(messages, "s1")
    expect(result?.id).toBe("a2")
  })

  test("empty messages returns undefined", () => {
    const result = findPendingInSession([], "s1")
    expect(result).toBeUndefined()
  })
})
