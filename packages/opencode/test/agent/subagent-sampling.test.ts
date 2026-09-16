import { test, expect, afterEach } from "bun:test"
import { Effect } from "effect"
import { pipe } from "effect/Function"
import { mergeDeep } from "remeda"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import fs from "fs"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { DEFAULT_MODEL_SAMPLING } from "../../src/session/model-sampling"

/**
 * Every subagent used to send the same wire body — temperature 0.65, top_p
 * 0.95, presence_penalty 0.2, repetition_penalty 1.1 — because those are
 * DEFAULT_MODEL_SAMPLING, the model-wide TUI default. Nothing about the agent
 * reached the request, so "explore the repo" and "invent five designs" were
 * sampled identically.
 *
 * These tests hold the declaration (agent.ts) and the reachability (llm.ts
 * merge order) separately, because the second is what silently broke the first:
 * `repetition_penalty` was merged AFTER `agent.options`.
 */
const SUBAGENTS = ["explorer_agent", "researcher_agent", "general_agent", "coder_agent", "media_agent"] as const

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("every native subagent declares its own sampling, not the model default", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = new Map((await load(tmp.path, (svc) => svc.list())).map((a) => [a.name, a]))
      for (const name of SUBAGENTS) {
        const agent = agents.get(name)
        expect(agent).toBeDefined()
        expect(typeof agent!.temperature).toBe("number")
        expect(typeof agent!.topP).toBe("number")
        expect(typeof agent!.presencePenalty).toBe("number")
        expect(typeof agent!.options["repetition_penalty"]).toBe("number")
      }
    },
  })
})

test("verification identities are sampled tighter than generative ones", async () => {
  // The contract is the ordering, not the literal numbers: an agent whose
  // output is checked by an oracle must be more reproducible than one whose
  // output is a candidate set. Pin the relation so a later tweak to one value
  // cannot quietly invert it.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = new Map((await load(tmp.path, (svc) => svc.list())).map((a) => [a.name, a]))
      const t = (n: string) => agents.get(n)!.temperature!
      const pp = (n: string) => agents.get(n)!.presencePenalty!
      const rp = (n: string) => agents.get(n)!.options["repetition_penalty"] as number
      for (const verifier of ["explorer_agent", "coder_agent"]) {
        for (const generator of ["general_agent", "media_agent"]) {
          expect(t(verifier)).toBeLessThan(t(generator))
          expect(pp(verifier)).toBeLessThan(pp(generator))
        }
        // Code and file paths legitimately repeat tokens; penalising that is
        // how an identifier comes back renamed. No penalty on those two.
        expect(rp(verifier)).toBe(1)
      }
    },
  })
})

test("an agent's repetition_penalty survives the model-wide merge", async () => {
  // Mirrors llm.ts option assembly. Before the fix, `sampling` merged last and
  // this returned 1.1 for every agent no matter what the agent declared.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = new Map((await load(tmp.path, (svc) => svc.list())).map((a) => [a.name, a]))
      for (const name of SUBAGENTS) {
        const merged: Record<string, any> = pipe(
          {} as Record<string, any>,
          mergeDeep({ repetition_penalty: DEFAULT_MODEL_SAMPLING.repetition_penalty }),
          mergeDeep(agents.get(name)!.options as Record<string, any>),
        )
        expect(merged["repetition_penalty"]).toBe(agents.get(name)!.options["repetition_penalty"])
      }
      expect(agents.get("coder_agent")!.options["repetition_penalty"]).not.toBe(
        DEFAULT_MODEL_SAMPLING.repetition_penalty,
      )
    },
  })
})

test("llm.ts merges model-wide sampling before the agent, not after", async () => {
  // The mirror above only proves mergeDeep's semantics. This is the claim that
  // actually broke: the ORDER in the real assembly. Read the source, because
  // the option pipe is inline in the request generator and has no seam to call.
  const llm = fs.readFileSync(path.join(__dirname, "../../src/session/llm.ts"), "utf8")
  const sampling = llm.indexOf("mergeDeep({ repetition_penalty: sampling.repetition_penalty })")
  const agent = llm.indexOf("mergeDeep(input.agent.options)")
  const variant = llm.indexOf("mergeDeep(variant)")
  expect(sampling).toBeGreaterThan(-1)
  expect(agent).toBeGreaterThan(-1)
  expect(sampling).toBeLessThan(agent)
  expect(agent).toBeLessThan(variant)
})
