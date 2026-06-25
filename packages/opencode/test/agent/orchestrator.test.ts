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

test("orchestrator prompt contains strategist and ADID references", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orch = await load(tmp.path, (svc) => svc.get("orchestrator"))
      expect(orch!.prompt).toBeDefined()
      expect(orch!.prompt!.length).toBeGreaterThan(100)
      expect(orch!.prompt!).toContain("STRATEGIST")
      expect(orch!.prompt!).toContain("ADID Framework")
    },
  })
})

test("orchestrator denies edit, write, bash, task, todowrite", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const orch = await load(tmp.path, (svc) => svc.get("orchestrator"))
      expect(evalPerm(orch, "edit")).toBe("deny")
      expect(evalPerm(orch, "write")).toBe("deny")
      expect(evalPerm(orch, "bash")).toBe("deny")
      expect(evalPerm(orch, "task")).toBe("deny")
      expect(evalPerm(orch, "todowrite")).toBe("deny")
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
