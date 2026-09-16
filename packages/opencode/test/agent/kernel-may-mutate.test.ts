import { test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import fs from "fs"
import path from "path"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"

/**
 * `may_mutate` in the kernel is a promise made to the delegating parent, and
 * nothing was checking it against the runtime ACL that actually decides.
 *
 * The two canons diverged exactly where you would expect: `explorer_agent`
 * spells out a read-only deny list, `general_agent` — same `may_mutate: false`,
 * same subagent kind — does not, and carries no path restriction either, so it
 * could edit any file in the project while the kernel told its caller it could
 * not. @AUTHORITY_SEPARATION: "No role may silently inherit another role's
 * authority."
 *
 * Read the contract from the installed artifact rather than a hardcoded list,
 * so a new identity cannot be added without this test noticing it.
 *
 * `may_mutate: false` means no PRODUCT-SOURCE mutation. Writing plan artifacts
 * is the separate PLAN_WRITE action class, which `plan_mode` already models:
 * deny the mutation tools globally, re-allow them scoped to `plans/*`.
 */
const KERNEL = fs.readFileSync(path.join(__dirname, "../../src/session/prompt/reasoning_prompt.txt"), "utf8")

/** Identity name -> may_mutate, parsed out of §5 IDENTITY_CONTRACTS. */
function contracts(): Map<string, boolean> {
  const out = new Map<string, boolean>()
  // Split rather than lookahead: `\Z` is a Python anchor and matches a literal
  // Z in JS, which silently drops the LAST identity block from the sweep.
  for (const chunk of KERNEL.split(/^### /m).slice(1)) {
    const head = chunk.split(/\r?\n/)[0] ?? ""
    const name = /^([A-Z_]+)\s*$/.exec(head)
    const declared = /^may_mutate:\s*(true|false)\s*$/m.exec(chunk)
    if (name && declared) out.set(name[1]!.toLowerCase(), declared[1] === "true")
  }
  return out
}

const MUTATORS = ["edit", "write", "multiedit", "apply_patch"] as const

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("the kernel declares may_mutate for every native agent", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const declared = contracts()
      expect(declared.size).toBeGreaterThan(5)
      const agents = (await load(tmp.path, (svc) => svc.list())).filter(
        // `hidden` agents are internal procedures, not identities anyone can be
        // or delegate to — `title_agent` is the session naming a thread. The
        // kernel deliberately does not declare them (2026-09-16): a contract in
        // the per-turn prefix that governs nothing is prefix spent on nothing.
        // Their guard is the runtime ACL below, which is the layer that decides.
        (a) => a.native !== false && a.hidden !== true,
      )
      const undeclared = agents.map((a) => a.name).filter((n) => !declared.has(n))
      // A runtime agent with no kernel contract is ungoverned by definition.
      expect(undeclared).toEqual([])
    },
  })
})

test("may_mutate:false identities cannot reach product source", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const declared = contracts()
      const agents = await load(tmp.path, (svc) => svc.list())
      const offenders: string[] = []
      for (const agent of agents) {
        if (declared.get(agent.name) !== false) continue
        for (const tool of MUTATORS) {
          // "*" is the general case — a product-source path, not a plan artifact.
          if (Permission.evaluate(tool, "*", agent.permission).action !== "deny")
            offenders.push(`${agent.name}:${tool}`)
        }
      }
      expect(offenders).toEqual([])
    },
  })
})

test("plan artifacts stay writable where the gates produce them", async () => {
  // The inverse guard: the fix for the above must not turn plan-producing
  // identities read-only, or G3 cannot emit a MASTER_PLAN at all.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      for (const name of ["plan_mode", "general_agent"]) {
        const agent = agents.find((a) => a.name === name)
        expect(agent).toBeDefined()
        expect(Permission.evaluate("edit", path.join("plans", "x.md"), agent!.permission).action).not.toBe("deny")
      }
    },
  })
})

test("hidden agents are denied everything, kernel contract or not", async () => {
  // The other half of dropping TITLE_AGENT from §5: what the kernel no longer
  // promises, the ACL must still refuse. `title_agent` carries `"*": "deny"`.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const hidden = (await load(tmp.path, (svc) => svc.list())).filter((a) => a.hidden === true)
      expect(hidden.length).toBeGreaterThan(0)
      for (const agent of hidden)
        for (const tool of [...MUTATORS, "bash", "task"])
          expect(Permission.evaluate(tool, "*", agent.permission).action).toBe("deny")
    },
  })
})
