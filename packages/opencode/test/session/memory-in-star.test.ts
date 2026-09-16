import { test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import path from "path"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { MEMORY_FILE, readMemory } from "../../src/tool/memory"

/**
 * Permanent memory used to be reachable from exactly one identity
 * (`reasoning_mode`) and to enter the context only when someone called the
 * tool — while the kernel told G1, whose identities all denied it, to read it
 * at grounding. "Written and never read is not memory."
 *
 * Two changes, two guards: every identity may read and write it, and a fold
 * reproduces it verbatim inside <memory> so what was written before a boundary
 * is still there after one.
 */
function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("every native identity may read and write permanent memory", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = (await load(tmp.path, (svc) => svc.list())).filter((a) => a.native !== false && a.hidden !== true)
      expect(agents.length).toBeGreaterThan(5)
      const denied = agents
        .filter((a) => Permission.evaluate("memory", "*", a.permission).action === "deny")
        .map((a) => a.name)
      expect(denied).toEqual([])
    },
  })
})

test("readMemory returns the file, and empty string when it was never written", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // No layer: readMemory is deliberately service-free so `compact()` does
      // not gain a filesystem requirement on the turn-end path.
      const read = () => Effect.runPromise(provideInstance(tmp.path)(readMemory()))
      // A session that never wrote memory is the normal case, not an error:
      // returning "" keeps the fold from failing on a missing file.
      expect(await read()).toBe("")
      await Bun.write(path.join(tmp.path, MEMORY_FILE), "criterion: oracle must be able to fail\n")
      expect(await read()).toContain("criterion: oracle must be able to fail")
    },
  })
})
