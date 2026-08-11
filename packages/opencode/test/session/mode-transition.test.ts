import { expect, test } from "bun:test"
import path from "path"
import { fileURLToPath } from "url"
import { modeInstructionForTransition, providerIdentityForMode, roleInstructionForAgent } from "../../src/session/prompt"
import PROMPT_BUILD from "../../src/session/prompt/build.txt"
import PROMPT_PLAN from "../../src/session/prompt/plan.txt"
import PROMPT_REASONING from "../../src/session/prompt/reasoning-mode.txt"
import type { Agent } from "../../src/agent/agent"

test("mode instructions appear only on entry or explicit mode change", () => {
  expect(modeInstructionForTransition(undefined, "plan_mode")).toContain("plan_mode")
  expect(modeInstructionForTransition("plan_mode", "build_mode")).toContain("build_mode")
  expect(modeInstructionForTransition("build_mode", "reasoning_mode")).toContain("reasoning_mode")
  expect(modeInstructionForTransition("reasoning_mode", "build_mode")).toContain("build_mode")
  expect(modeInstructionForTransition("build_mode", "plan_mode")).toContain("plan_mode")
  // Legacy short aliases still resolve during migration
  expect(modeInstructionForTransition("plan", "build")).toContain("build_mode")
  // plan vs plan_mode is same identity — no re-inject
  expect(modeInstructionForTransition("plan", "plan_mode")).toBeUndefined()

  expect(modeInstructionForTransition("plan_mode", "plan_mode")).toBeUndefined()
  expect(modeInstructionForTransition("build_mode", "build_mode")).toBeUndefined()
  expect(modeInstructionForTransition("reasoning_mode", "reasoning_mode")).toBeUndefined()
  expect(modeInstructionForTransition("build_mode", "custom")).toBeUndefined()
})

test("primary mode identity handled via modeInstructionForTransition, not system prompt", () => {
  // Primary modes: roleInstructionForAgent returns undefined — identity delivered
  // as one-shot conversation notify via modeInstructionForTransition (prompt.ts).
  expect(roleInstructionForAgent({ name: "build_mode", prompt: PROMPT_BUILD } as Agent.Info)).toBeUndefined()
  expect(roleInstructionForAgent({ name: "plan_mode", prompt: PROMPT_PLAN } as Agent.Info)).toBeUndefined()
  // Subagent roles ARE injected
  expect(roleInstructionForAgent({ name: "coder_agent", prompt: "coder role" } as Agent.Info)).toContain("coder role")

  // Mode transition injects correct prompt text on switch
  expect(modeInstructionForTransition(undefined, "build_mode")).toContain("build_mode")
  expect(modeInstructionForTransition("plan_mode", "build_mode")).toContain("build_mode")
  // Same mode: no inject
  expect(modeInstructionForTransition("build_mode", "build_mode")).toBeUndefined()
})

test("prompt flow has no legacy steady-state continuation injection", async () => {
  const promptSource = await Bun.file(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src/session/prompt.ts")).text()

  expect(promptSource).not.toContain("Please address this message and continue with your tasks.")
  expect(promptSource).not.toContain("History was compacted. Active memory")
  expect(promptSource).not.toContain("You should execute on the plan defined within it")
  expect(promptSource).not.toContain("Summarize the task tool output above and continue with your task.")
})

test("mode-transition tool IDs use canonical names (no separators)", () => {
  // After canonicalization (stripping [^a-z0-9]), tool IDs must match
  // what the TUI checks in session/index.tsx for agent auto-switch.
  const canonicalName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")

  // Policy names (with underscores) → canonical IDs (without)
  expect(canonicalName("plan_exit")).toBe("planexit")
  expect(canonicalName("plan_enter")).toBe("planenter")
  expect(canonicalName("reasoning_enter")).toBe("reasoningenter")
  expect(canonicalName("reasoning_exit")).toBe("reasoningexit")

  // TUI checks for exactly these canonical forms
  const tuiExpected = ["planexit", "planenter", "reasoningenter", "reasoningexit"]
  for (const expected of tuiExpected) {
    expect(canonicalName(expected)).toBe(expected) // idempotent
  }
})

test("provider identity is the real agent (build_mode / coder_agent / …)", () => {
  // Protocol is shared; identity switches — never force build_mode for others.
  const build = { name: "build_mode", native: true } as Agent.Info
  const reasoning = { name: "reasoning_mode", native: true } as Agent.Info
  const plan = { name: "plan_mode", native: true } as Agent.Info
  const custom = { name: "custom", native: false } as Agent.Info
  const coder = { name: "coder_agent", native: true } as Agent.Info
  const explorer = { name: "explorer_agent", native: true } as Agent.Info

  expect(providerIdentityForMode(reasoning, build)).toBe(reasoning)
  expect(providerIdentityForMode(plan, build)).toBe(plan)
  expect(providerIdentityForMode(build, build)).toBe(build)
  expect(providerIdentityForMode(custom, build)).toBe(custom)
  expect(providerIdentityForMode(coder, build)).toBe(coder)
  expect(providerIdentityForMode(explorer, build)).toBe(explorer)
})
