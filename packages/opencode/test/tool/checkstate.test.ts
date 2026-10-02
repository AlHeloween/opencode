import { expect, test } from "bun:test"
import { forecastContext } from "../../src/session/context-forecast"
import { forecastMetadata, formatModeSnapshot, formatSummaries, formatWindow } from "../../src/tool/checkstate"

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
    forecast: forecastContext([7_500, 7_500, 7_500, 7_500], 30_000),
    armed: false,
    auto: true,
  })
  expect(output).toContain("Auto-fold at: 120,000 request tokens")
  expect(output).toContain("Open window now: 90,000 tokens (75% of the fold threshold)")
  // 30 000 headroom / 7 500 per turn = 4 turns.
  expect(output).toContain("Your context window: 90,000 of 163,840 tokens")
  expect(output).toContain("approximately 4 more model requests before compact")
  expect(output).toContain("continue from the preserved state")
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
    forecast: forecastContext([], 140_000),
    armed: true,
    auto: false,
  })
  expect(output).toContain("Headroom: 140,000 tokens")
  expect(output).toContain("estimate unavailable")
  expect(output).not.toContain("more turn")
  expect(output).toContain("Boundary fold armed this turn: yes")
  expect(output).toContain("Automatic fold: OFF")
})

test("few measured request increments are not a rate (supersedes user-turn averaging)", () => {
  expect(forecastContext([64_000], 100_000).turnsLeft).toBeNull()
  expect(forecastContext([0, 0, 0, 0], 100_000).turnsLeft).toBeNull()
  expect(forecastContext([15_000, 15_000, 15_000, 15_000], 60_000).turnsLeft).toBe(4)
})

test("metadata preserves the lower bound and estimate method shown to the agent", () => {
  const forecast = forecastContext([16000, 8000, 4000, 2000, 1000, 500], 100_000)
  expect(forecastMetadata(forecast)).toEqual({ turns_left: 1024, turns_at_least: true, forecast_method: "exponential", forecast_samples: 6 })
})

test("open summaries are listed with their ids, so they can be fixed before the fold", () => {
  // Without the ids an identity can read summaries but cannot tell which are
  // still open — it does not know what it is about to carry into m*.
  const output = formatSummaries([
    { id: "ckpt_01", fromMessageID: "msg_a", toMessageID: "msg_b", body: "## Goal\n- ship the fold\n" },
    { id: "ckpt_02", fromMessageID: "msg_c", toMessageID: "msg_d", body: "## Goal\n- rename getmode\n" },
  ])
  expect(output).toContain("Open summaries (2)")
  expect(output).toContain("`ckpt_01`  msg_a..msg_b")
  expect(output).toContain("`ckpt_02`  msg_c..msg_d")
  // The label is the first non-empty body line, so the list is readable.
  expect(output).toContain("## Goal")
  // Bodies are Inferred and editable; links are Exact. Say so where it is read.
  expect(output).toContain("Bodies are Inferred and editable")
})

test("no open summaries says what the next fold would carry", () => {
  const output = formatSummaries([])
  expect(output).toContain("none")
  expect(output).toContain("recent tail only")
})
