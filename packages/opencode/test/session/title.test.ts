import { describe, expect, test } from "bun:test"
import { isDefaultTitle, titleFromUserText, titleFromUserParts } from "../../src/session/session"

describe("session title helpers", () => {
  test("isDefaultTitle matches parent and child placeholders", () => {
    expect(isDefaultTitle("New session - 2026-07-16T13:35:07.804Z")).toBe(true)
    expect(isDefaultTitle("Child session - 2026-07-16T11:06:25.795Z")).toBe(true)
    expect(isDefaultTitle("Explore TUI architecture")).toBe(false)
    expect(isDefaultTitle("New session")).toBe(false)
  })

  test("isDefaultTitle matches forked placeholders", () => {
    expect(isDefaultTitle("New session - 2026-07-16T13:35:07.804Z (fork #1)")).toBe(true)
    expect(isDefaultTitle("New session - 2026-07-16T13:35:07.804Z (fork #12)")).toBe(true)
    expect(isDefaultTitle("Explore TUI (fork #1)")).toBe(false)
  })

  test("titleFromUserText strips UTC trailer and collapses whitespace", () => {
    expect(titleFromUserText("Hi boss\n\nUTC: 2026-07-16T13:35:07.945Z")).toBe("Hi boss")
    expect(titleFromUserText("current: 72% cache\nplease debug  UTC: 2026-07-16T11:06:25.795Z")).toBe(
      "current: 72% cache please debug",
    )
    expect(titleFromUserText("   \n\n   ")).toBeUndefined()
  })

  test("titleFromUserText truncates long prompts", () => {
    const long = "a".repeat(120)
    const title = titleFromUserText(long)
    expect(title).toBeDefined()
    expect(title!.length).toBe(100)
    expect(title!.endsWith("...")).toBe(true)
  })

  test("titleFromUserParts prefers non-synthetic text over subtasks", () => {
    expect(
      titleFromUserParts([
        { type: "text", text: "synthetic only", synthetic: true },
        { type: "text", text: "Real prompt here\n\nUTC: 2026-07-16T13:35:07.945Z" },
        { type: "subtask", prompt: "should not win" },
      ]),
    ).toBe("Real prompt here")
  })

  test("titleFromUserParts falls back to subtask prompts", () => {
    expect(
      titleFromUserParts([
        { type: "subtask", prompt: "Explore TUI architecture thoroughly" },
        { type: "text", text: "ignored", synthetic: true },
      ]),
    ).toBe("Explore TUI architecture thoroughly")
  })
})
