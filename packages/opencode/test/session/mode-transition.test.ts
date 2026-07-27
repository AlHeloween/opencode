import { expect, test } from "bun:test"
import path from "path"
import { fileURLToPath } from "url"
import { modeInstructionForTransition } from "../../src/session/prompt"

test("mode instructions appear only on entry or explicit mode change", () => {
  expect(modeInstructionForTransition(undefined, "plan")).toContain("Plan mode")
  expect(modeInstructionForTransition("plan", "build")).toContain("Build mode")
  expect(modeInstructionForTransition("build", "reasoning")).toContain("Reasoning mode")
  expect(modeInstructionForTransition("reasoning", "build")).toContain("Build mode")

  expect(modeInstructionForTransition("plan", "plan")).toBeUndefined()
  expect(modeInstructionForTransition("build", "build")).toBeUndefined()
  expect(modeInstructionForTransition("reasoning", "reasoning")).toBeUndefined()
  expect(modeInstructionForTransition("build", "custom")).toBeUndefined()
})

test("prompt flow has no legacy steady-state continuation injection", async () => {
  const promptSource = await Bun.file(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/session/prompt.ts")).text()

  expect(promptSource).not.toContain("Please address this message and continue with your tasks.")
  expect(promptSource).not.toContain("History was compacted. Active memory")
  expect(promptSource).not.toContain("You should execute on the plan defined within it")
  expect(promptSource).not.toContain("Summarize the task tool output above and continue with your task.")
})
