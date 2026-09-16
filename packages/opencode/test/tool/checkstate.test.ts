import { expect, test } from "bun:test"
import { burnRate, formatModeSnapshot, formatWindow } from "../../src/tool/checkstate"

test("checkstate returns the complete ordered runtime ACL without changing the tool catalog", () => {
  const output = formatModeSnapshot(
    {
      name: "plan_mode",
      mode: "primary",
      subagents: ["explorer_agent"],
      permission: [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "edit", pattern: "plans/*", action: "allow" },
      ],
    },
    ["build_mode", "explorer_agent", "plan_mode"],
  )

  expect(output).toContain("Current identity: plan_mode")
  expect(output).toContain("Delegable agents: explorer_agent")
  expect(output).toContain("1. * * → deny")
  expect(output).toContain("2. read * → allow")
  expect(output).toContain("3. edit plans/* → allow")
  expect(output).toContain("Available agents: build_mode, explorer_agent, plan_mode")
})

/**
 * "Человек знает когда он отрубится, а вот агент не знает." The window block
 * exists so the agent can pick its own boundary instead of being folded
 * wherever the ceiling happens to land. These tests hold the two numbers a
 * wrong answer would be worst on: how much room is left, and how long that is.
 */
test("the window block reports headroom and converts it to turns", () => {
  const output = formatWindow({
    model: "deepseek/deepseek-v4",
    limit: 163_840,
    foldAt: 120_000,
    open: 90_000,
    perTurn: 7_500,
    armed: false,
    auto: true,
  })
  expect(output).toContain("Auto-fold at: 120,000 tokens")
  expect(output).toContain("Open window now: 90,000 tokens (75% of the fold threshold)")
  // 30 000 headroom / 7 500 per turn = 4 turns.
  expect(output).toContain("Headroom: 30,000 tokens ~ 4 more turns")
  expect(output).toContain("Boundary fold armed this turn: no")
  expect(output).toContain("Automatic fold: ON")
})

test("an unknown burn rate is reported as unknown, not as zero turns", () => {
  // Reporting "0 turns left" from a missing rate would push a fold on every
  // call. A gauge that cannot read says so.
  const output = formatWindow({
    model: "zai/glm-5.3",
    limit: 200_000,
    foldAt: 150_000,
    open: 10_000,
    perTurn: null,
    armed: true,
    auto: false,
  })
  expect(output).toContain("Headroom: 140,000 tokens (burn rate unknown")
  expect(output).not.toContain("more turn")
  expect(output).toContain("Boundary fold armed this turn: yes")
  expect(output).toContain("Automatic fold: OFF")
})

test("one turn is not a rate", () => {
  // The first turn after a fold carries the folded star: dividing by one turn
  // reads it as the burn rate and reports a headroom of zero turns.
  expect(burnRate(64_000, 1)).toBeNull()
  expect(burnRate(0, 5)).toBeNull()
  expect(burnRate(60_000, 4)).toBe(15_000)
})
