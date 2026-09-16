import { expect, test } from "bun:test"
import { compilePattern, optionalPattern } from "../../src/tool/pattern"
import { matchesMessage } from "../../src/tool/sessionread"
import { resolveScope } from "../../src/tool/messagesearch"
import type { MessageV2 } from "../../src/session/message-v2"

/**
 * `grep`, `fossilgrep` and `logsearch` all take a pattern. The tools that read
 * conversation history did not: the only way to find something in a session was
 * to page through it by offset, and `messagesearch` swept every session in the
 * project whether you wanted that or not.
 */
const msg = (parts: unknown[]) => ({ info: { role: "assistant" }, parts } as unknown as MessageV2.WithParts)

test("scope defaults to the whole project and narrows only when asked", () => {
  // Default stays project-wide on purpose: messagesearch exists to find work
  // done in OTHER sessions, so silently narrowing would turn "no prior art"
  // into a wrong answer rather than a smaller one.
  expect(resolveScope(undefined, "ses_current")).toBeUndefined()
  expect(resolveScope("all", "ses_current")).toBeUndefined()
  expect(resolveScope("current", "ses_current")).toBe("ses_current")
  expect(resolveScope("ses_other", "ses_current")).toBe("ses_other")
})

test("a pattern matches a message's own text, not the rendering around it", () => {
  const filter = compilePattern("reasoning_content")
  expect(matchesMessage(msg([{ type: "text", text: "sent reasoning_content back" }]), filter)).toBe(true)
  expect(matchesMessage(msg([{ type: "text", text: "nothing relevant" }]), filter)).toBe(false)
})

test("tool output and reasoning are searchable, not just what was said about them", () => {
  // The thing you are hunting in a session is as often in a command's output as
  // in the prose around it.
  const filter = compilePattern("SQLITE_CONSTRAINT")
  expect(
    matchesMessage(msg([{ type: "tool", tool: "bash", state: { output: "SQLITE_CONSTRAINT_FOREIGNKEY" } }]), filter),
  ).toBe(true)
  expect(
    matchesMessage(msg([{ type: "tool", tool: "bash", state: { error: "SQLITE_CONSTRAINT failed" } }]), filter),
  ).toBe(true)
  expect(matchesMessage(msg([{ type: "reasoning", text: "SQLITE_CONSTRAINT is an FK" }]), filter)).toBe(true)
  expect(matchesMessage(msg([{ type: "tool", tool: "bash", state: { output: "ok" } }]), filter)).toBe(false)
})

test("case sensitivity is opt-in", () => {
  expect(compilePattern("ckpt").test("CKPT_01")).toBe(false)
  expect(compilePattern("ckpt", true).test("CKPT_01")).toBe(true)
})

test("no pattern means no filtering, not a filter that matches nothing", () => {
  expect(optionalPattern(undefined)).toBeUndefined()
  expect(optionalPattern("")).toBeUndefined()
  expect(optionalPattern("ckpt_[0-9a-f]+")).toBeDefined()
})

test("a malformed pattern is a message the caller can act on, not a stack trace", () => {
  // It names the pattern and the reason: an obvious user error with an obvious
  // fix should not read like a defect in the tool.
  expect(() => compilePattern("(unclosed")).toThrow(/Invalid regular expression "\(unclosed"/)
})

test("a pattern the unicode engine rejects still compiles", () => {
  // `u` is stricter than the default engine — an unescaped brace is legal
  // without it. Refusing a pattern that plainly works in grep would be a
  // gratuitous difference between the two.
  expect(compilePattern("a{").test("a{")).toBe(true)
})
