import { afterAll, afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer, ManagedRuntime } from "effect"
import { MultiEditTool } from "../../src/tool/multiedit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { LSP } from "@/lsp/lsp"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Format } from "../../src/format"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"

// Each case boots the LSP/format stack — same budget as test/tool/edit.test.ts.
setDefaultTimeout(30_000)

const ctx = {
  sessionID: SessionID.make("ses_test-multiedit-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

afterEach(async () => {
  await Instance.disposeAll()
})

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    LSP.defaultLayer,
    AppFileSystem.defaultLayer,
    Format.defaultLayer,
    Bus.layer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
  ),
)

afterAll(async () => {
  await runtime.dispose()
})

const resolve = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* MultiEditTool
      return yield* info.init()
    }),
  )

const SEED = "line1: ORIGINAL-A\nline2: keep-me\nline3: ORIGINAL-B\nline4: keep-me-too\n"

async function seed(dir: string, name: string) {
  const filepath = path.join(dir, name)
  await fs.writeFile(filepath, SEED, "utf-8")
  return filepath
}

type Outcome = { failed: boolean; text: string }

async function run(filePath: string, edits: { oldString: string; newString: string; replaceAll?: boolean }[]) {
  const tool = await resolve()
  return Effect.runPromise(tool.execute({ filePath, edits }, ctx)).then<Outcome, Outcome>(
    () => ({ failed: false, text: "" }),
    (error: unknown) => ({ failed: true, text: String(error) }),
  )
}

/**
 * The contract this suite exists for.
 *
 * Measured 2026-09-30 (experiments/2026-09-30_multiedit-partial-apply/): the previous shape ran
 * one `edit` call per entry, and `edit` writes the file immediately — so when a later entry failed
 * to match, the earlier entries were ALREADY ON DISK while the tool's own description promised
 * «If any edit fails … none are applied — the file is rolled back to its original state» and the
 * report named only the failing entry. An agent that trusted that report and retried the call
 * re-applied the landed edits a second time.
 *
 * These cases pin the resolved behaviour: every entry is resolved in memory first, so a failure
 * writes nothing at all, and the error says so.
 */
describe("tool.multiedit — atomic application", () => {
  test("edit 1 valid, edit 2 impossible: NOTHING is written", async () => {
    await using tmp = await tmpdir()
    const filepath = await seed(tmp.path, "valid-then-impossible.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outcome = await run(filepath, [
          { oldString: "line1: ORIGINAL-A", newString: "line1: PATCHED-A" },
          { oldString: "line9: NEVER-EXISTS", newString: "x" },
        ])

        expect(outcome.failed).toBe(true)
        expect(outcome.text).toContain("NOTHING was written")
        expect(outcome.text).toContain("edit 2 of 2")
        // The real claim: the file the agent will find on disk is the file it had.
        expect(await fs.readFile(filepath, "utf-8")).toBe(SEED)
      },
    })
  })

  test("edit 1 impossible, edit 2 valid: the valid edit is NOT applied either", async () => {
    await using tmp = await tmpdir()
    const filepath = await seed(tmp.path, "impossible-then-valid.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outcome = await run(filepath, [
          { oldString: "line9: NEVER-EXISTS", newString: "x" },
          { oldString: "line3: ORIGINAL-B", newString: "line3: PATCHED-B" },
        ])

        expect(outcome.failed).toBe(true)
        expect(outcome.text).toContain("edit 1 of 2")
        expect(await fs.readFile(filepath, "utf-8")).toBe(SEED)
      },
    })
  })

  test("control: both valid — both land, reported per edit", async () => {
    await using tmp = await tmpdir()
    const filepath = await seed(tmp.path, "both-valid.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await resolve()
        const result = await Effect.runPromise(
          tool.execute(
            {
              filePath: filepath,
              edits: [
                { oldString: "line1: ORIGINAL-A", newString: "line1: PATCHED-A" },
                { oldString: "line3: ORIGINAL-B", newString: "line3: PATCHED-B" },
              ],
            },
            ctx,
          ),
        )

        expect(await fs.readFile(filepath, "utf-8")).toBe(
          "line1: PATCHED-A\nline2: keep-me\nline3: PATCHED-B\nline4: keep-me-too\n",
        )
        // Each entry keeps its own labelled hunk, as before — the report is the same
        // shape, and now it provably describes what was written.
        expect(result.output).toContain("Edit 1")
        expect(result.output).toContain("+line1: PATCHED-A")
        expect(result.output).toContain("Edit 2")
        expect(result.output).toContain("+line3: PATCHED-B")
        expect(result.metadata.results).toHaveLength(2)
      },
    })
  })

  test("the second edit operates on the result of the first", async () => {
    await using tmp = await tmpdir()
    const filepath = await seed(tmp.path, "sequential.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await resolve()
        await Effect.runPromise(
          tool.execute(
            {
              filePath: filepath,
              edits: [
                { oldString: "line1: ORIGINAL-A", newString: "line1: step-one" },
                { oldString: "line1: step-one", newString: "line1: step-two" },
              ],
            },
            ctx,
          ),
        )
        // Only the final text is on disk — a single write, not two.
        expect(await fs.readFile(filepath, "utf-8")).toBe(
          "line1: step-two\nline2: keep-me\nline3: ORIGINAL-B\nline4: keep-me-too\n",
        )
      },
    })
  })

  test("creates the file when the first edit seeds it with an empty oldString", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "created.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await resolve()
        await Effect.runPromise(
          tool.execute(
            {
              filePath: filepath,
              edits: [
                { oldString: "", newString: "alpha\nbeta\n" },
                { oldString: "beta", newString: "gamma" },
              ],
            },
            ctx,
          ),
        )
        expect(await fs.readFile(filepath, "utf-8")).toBe("alpha\ngamma\n")
      },
    })
  })

  test("a failure while creating leaves no file behind", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "never-created.txt")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outcome = await run(filepath, [
          { oldString: "", newString: "alpha\n" },
          { oldString: "NOT-IN-THE-SEED", newString: "x" },
        ])
        expect(outcome.failed).toBe(true)
        expect(await fs.readFile(filepath, "utf-8").then(() => "exists", () => "absent")).toBe("absent")
      },
    })
  })
})
