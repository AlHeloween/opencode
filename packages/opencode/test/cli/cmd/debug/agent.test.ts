import { expect, test } from "bun:test"
import type { Agent } from "@/agent/agent"
import type { Def as ToolDef } from "@/tool/tool"
import { resolveTools } from "@/cli/cmd/debug/agent"

test("debug agent resolves canonical IDs through their legacy policy guardrail", () => {
  const tools = [{ id: "applypatch", policy: "apply_patch" }] as ToolDef[]
  const agent = {
    permission: [{ permission: "edit", pattern: "*", action: "deny" }],
  } as Agent.Info

  expect(resolveTools(agent, tools)).toEqual({ applypatch: false })
})
