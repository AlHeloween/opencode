import { expect, test } from "bun:test"
import { providesExactEvidence, writesWorkingCopy } from "@/session/processor"

test("canonical tool identities retain worktree and Exact-evidence semantics", () => {
  expect(writesWorkingCopy("edit")).toBe(true)
  expect(writesWorkingCopy("applypatch")).toBe(false) // retired id — no longer a write identity
  // The non-canonical spelling is NOT the identity: `canonicalName` translates at the
  // resolver (wire name, aliases), never inside this predicate.
  expect(writesWorkingCopy("apply_patch")).toBe(false)
  expect(providesExactEvidence("sessionread")).toBe(true)
  expect(providesExactEvidence("session-read")).toBe(false)
})
