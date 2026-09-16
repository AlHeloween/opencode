import { test, expect, afterEach } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs"
import path from "path"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CompactTool } from "../../src/tool/compact"
import * as CompactionRequest from "../../src/session/compaction-request"

/**
 * Compaction had two triggers and the agent owned neither: the window-fill gate
 * (which can only see the ceiling, never that a task finished) and the user's
 * /compact. The `compact` tool is the third — self-rebuild at a boundary.
 *
 * It cannot fold inline: a tool runs inside the very window it would fold. So
 * it arms a request and the run loop consumes it at turn end. These tests hold
 * the arming, the consumption point, and who is allowed to ask.
 */
function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("a request is taken exactly once", () => {
  const id = "ses_take_once"
  expect(CompactionRequest.pendingFor(id)).toBe(false)
  CompactionRequest.request(id)
  expect(CompactionRequest.pendingFor(id)).toBe(true)
  expect(CompactionRequest.take(id)).toBe(true)
  // Second take is false: one boundary, one fold. A sticky flag would refold
  // every turn for the rest of the session.
  expect(CompactionRequest.take(id)).toBe(false)
  expect(CompactionRequest.pendingFor(id)).toBe(false)
})

test("arming twice in one turn still folds once", () => {
  const id = "ses_idempotent"
  CompactionRequest.request(id)
  CompactionRequest.request(id)
  expect(CompactionRequest.take(id)).toBe(true)
  expect(CompactionRequest.take(id)).toBe(false)
})

test("requests do not leak across sessions", () => {
  CompactionRequest.request("ses_a")
  expect(CompactionRequest.take("ses_b")).toBe(false)
  expect(CompactionRequest.take("ses_a")).toBe(true)
})

test("an armed request forces the fold; an unarmed one keeps the old cadence", () => {
  // The branch table, proven directly. Every row is a behaviour someone could
  // break by reordering the conditions.
  const d = CompactionRequest.foldDecision
  // Armed, a capture ran this stop: fold now — the fresh s represents the head.
  expect(d({ requested: true, captureDue: true, sidecarCaptured: true })).toBe("forced")
  // Armed, capture attempted but idempotent (lone message*): prior s stand in.
  expect(d({ requested: true, captureDue: true, sidecarCaptured: false })).toBe("forced")
  // Armed, no capture ran: summarize first or the fold goes tail-only.
  expect(d({ requested: false || true, captureDue: false, sidecarCaptured: false })).toBe("capture-then-forced")
  // Unarmed: the pre-existing rules are untouched.
  expect(d({ requested: false, captureDue: true, sidecarCaptured: true })).toBe("defer")
  expect(d({ requested: false, captureDue: true, sidecarCaptured: false })).toBe("cadence")
  expect(d({ requested: false, captureDue: false, sidecarCaptured: false })).toBe("cadence")
})

test("the run loop consumes the request at the turn boundary, not mid-stream", () => {
  // WHERE, not what: folding inline would fold the window the current turn is
  // still streaming against. `take` must sit in the turn-end cadence block,
  // and its result must reach foldDecision rather than being computed twice.
  const prompt = fs.readFileSync(path.join(__dirname, "../../src/session/prompt.ts"), "utf8")
  const take = prompt.indexOf("const foldRequested = CompactionRequest.take(sessionID)")
  const captureDue = prompt.indexOf("const captureDue =")
  const decision = prompt.indexOf("CompactionRequest.foldDecision({ requested: foldRequested")
  expect(take).toBeGreaterThan(-1)
  expect(captureDue).toBeGreaterThan(-1)
  expect(decision).toBeGreaterThan(-1)
  expect(take).toBeGreaterThan(captureDue)
  expect(take).toBeLessThan(decision)
})

test("subagents cannot fold a window they were handed", async () => {
  // @AUTHORITY_SEPARATION: the boundary belongs to whoever owns the session.
  // A subagent is given a window; it does not own one.
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      for (const name of ["explorer_agent", "researcher_agent", "general_agent", "coder_agent", "media_agent"]) {
        const agent = agents.find((a) => a.name === name)
        expect(agent).toBeDefined()
        expect(Permission.evaluate("compact", "*", agent!.permission).action).toBe("deny")
      }
    },
  })
})

test("primaries that own G9 may fold their own window", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      for (const name of ["build_mode", "plan_mode", "orchestrator_agent"]) {
        const agent = agents.find((a) => a.name === name)
        expect(agent).toBeDefined()
        expect(Permission.evaluate("compact", "*", agent!.permission).action).not.toBe("deny")
      }
    },
  })
})

test("the tool initializes and arms the session it was called in", async () => {
  // End-to-end through the real definition: proves the .txt description loads
  // and that execute() reaches the request channel the run loop reads.
  await using tmp = await tmpdir()
  const sessionID = SessionID.make("ses_tool_exec")
  const ctx = {
    sessionID,
    messageID: MessageID.make(""),
    callID: "",
    agent: "build_mode",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
  }
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await Effect.runPromise(
        provideInstance(tmp.path)(
          Effect.gen(function* () {
            const tool = yield* (yield* CompactTool).init()
            expect(tool.description.length).toBeGreaterThan(200)
            const first = yield* tool.execute({}, ctx as never)
            const second = yield* tool.execute({ reason: "plan closed" }, ctx as never)
            return { first, second }
          }),
        ).pipe(Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))),
      )
      expect(result.first.metadata.armed).toBe(true)
      // Second call in the same turn does not arm a second fold.
      expect(result.second.metadata.armed).toBe(false)
      expect(CompactionRequest.take(sessionID)).toBe(true)
      expect(CompactionRequest.take(sessionID)).toBe(false)
    },
  })
})
