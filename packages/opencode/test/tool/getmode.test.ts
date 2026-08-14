import { expect, test } from "bun:test"
import { formatModeSnapshot } from "../../src/tool/getmode"

test("getmode returns the complete ordered runtime ACL without changing the tool catalog", () => {
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
