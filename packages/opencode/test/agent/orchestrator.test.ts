import { test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

function evalPerm(agent: Agent.Info | undefined, permission: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, "*", agent.permission).action
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("orchestrator exists in agent list", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      const names = agents.map((a) => a.name)
      expect(names).toContain("orchestrator")
    },
  })
})

test("orchestrator is primary mode, native, not hidden", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orch = await load(tmp.path, (svc) => svc.get("orchestrator"))
      expect(orch).toBeDefined()
      expect(orch!.mode).toBe("primary")
      expect(orch!.native).toBe(true)
      expect(orch!.hidden).toBeFalsy()
    },
  })
})

test("orchestrator has light green color", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orch = await load(tmp.path, (svc) => svc.get("orchestrator"))
      expect(orch!.color).toBe("#90EE50")
    },
  })
})

test("orchestrator prompt is coordinator contract (plans, no source edits)", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orch = await load(tmp.path, (svc) => svc.get("orchestrator"))
      expect(orch!.prompt).toBeDefined()
      expect(orch!.prompt!).toContain("agent.orchestrator")
      expect(orch!.prompt!).toMatch(/plans|delegate/i)
    },
  })
})

test("orchestrator is coordinator: no shell; plan dirs only; task + explore only", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orch = await load(tmp.path, (svc) => svc.get("orchestrator"))
      // No implementer shell — workers (build) execute
      expect(evalPerm(orch, "bash")).toBe("deny")
      expect(evalPerm(orch, "cmd")).toBe("deny")
      expect(evalPerm(orch, "powershell")).toBe("deny")
      expect(evalPerm(orch, "run")).toBe("deny")
      // Default path deny for edit/write (*); plan paths allowed separately
      expect(evalPerm(orch, "edit")).toBe("deny")
      expect(evalPerm(orch, "write")).toBe("deny")
      expect(Permission.evaluate("edit", "plans/foo.md", orch!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", "plans_completed/foo.md", orch!.permission).action).toBe("allow")
      expect(Permission.evaluate("edit", "packages/opencode/src/x.ts", orch!.permission).action).toBe("deny")
      // Delegate only via task; subagents list is explore-only
      expect(evalPerm(orch, "task")).toBe("allow")
      expect(orch!.subagents).toEqual(["explore"])
      expect(orch!.subagents).not.toContain("general")
      expect(orch!.subagents).not.toContain("coder")
    },
  })
})

test("orchestrator allows read, glob, grep, list, webfetch, universalsearch, messagesearch, session-read", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orch = await load(tmp.path, (svc) => svc.get("orchestrator"))
      expect(evalPerm(orch, "read")).toBe("allow")
      expect(evalPerm(orch, "glob")).toBe("allow")
      expect(evalPerm(orch, "grep")).toBe("allow")
      expect(evalPerm(orch, "list")).toBe("allow")
      expect(evalPerm(orch, "webfetch")).toBe("allow")
      expect(evalPerm(orch, "universalsearch")).toBe("allow")
      expect(evalPerm(orch, "messagesearch")).toBe("allow")
      expect(evalPerm(orch, "session-read")).toBe("allow")
    },
  })
})

test("orchestrator is selectable as primary (not subagent only)", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      const primaryNames = agents.filter((a) => a.mode !== "subagent" && !a.hidden).map((a) => a.name)
      expect(primaryNames).toContain("orchestrator")
    },
  })
})
