import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Bus } from "../../src/bus"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { RunTool } from "../../src/tool/run"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

/**
 * The view has to be proven on a real command, not only as a pure function.
 * `applyView` being correct says nothing about whether `run` actually calls it,
 * which is the layer the change lives on.
 */
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_run_view"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build_mode",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

/** Emit ten numbered lines; #4 and #8 look like errors. The trailing
 *  newline from console.log makes that 11 lines to a splitter, which is what
 *  the view counts — the count is of the text, not of the writes. */
const SCRIPT =
  "for (let i = 1; i <= 10; i++) console.log(i % 4 === 0 ? `ERROR at ${i}` : `line ${i}`)"

function exec(dir: string, extra: Record<string, unknown>) {
  return runtime.runPromise(
    provideInstance(dir)(
      Effect.gen(function* () {
        const tool = yield* (yield* RunTool).init()
        return yield* tool.execute(
          {
            binary: process.execPath,
            args: ["-e", SCRIPT],
            description: "emit ten lines",
            run_in_background: false,
            ...extra,
          } as never,
          ctx as never,
        )
      }),
    ),
  )
}

describe("run view", () => {
  test("no view returns every line", async () => {
    await using tmp = await tmpdir()
    const result = await exec(tmp.path, {})
    expect(result.output).toContain("line 1")
    expect(result.output).toContain("ERROR at 8")
    expect(result.output).not.toContain("view:")
  })

  test("pattern keeps only matching lines", async () => {
    await using tmp = await tmpdir()
    const result = await exec(tmp.path, { pattern: "^ERROR" })
    expect(result.output).toContain("ERROR at 4")
    expect(result.output).toContain("ERROR at 8")
    expect(result.output).not.toContain("line 1")
    // And it says what it dropped, so a partial answer is not read as complete.
    expect(result.output).toContain("view:")
    expect(result.output).toContain("11 total")
  })

  test("head counts matches, not raw lines", async () => {
    await using tmp = await tmpdir()
    const result = await exec(tmp.path, { pattern: "^ERROR", head: 1 })
    expect(result.output).toContain("ERROR at 4")
    expect(result.output).not.toContain("ERROR at 8")
  })

  test("a line range addresses the output directly", async () => {
    await using tmp = await tmpdir()
    const result = await exec(tmp.path, { lines: "2-3" })
    expect(result.output).toContain("line 2")
    expect(result.output).toContain("line 3")
    expect(result.output).not.toContain("line 5")
  })

  test("the full output is kept even when the view narrowed it", async () => {
    // The whole point of a view is that you can go back over what it hid,
    // without re-running a command that may have had a side effect.
    await using tmp = await tmpdir()
    const result = await exec(tmp.path, { pattern: "^ERROR" })
    const saved = (result.metadata as { outputPath?: string }).outputPath
    expect(saved).toBeTruthy()
    const full = await Bun.file(saved!).text()
    expect(full).toContain("line 1")
    expect(full).toContain("ERROR at 4")
  })

  test("a pattern that matches nothing says so instead of looking empty", async () => {
    await using tmp = await tmpdir()
    const result = await exec(tmp.path, { pattern: "NOTHING_MATCHES_THIS" })
    expect(result.output).toContain("no lines matched")
  })
})
