import { describe, test, expect } from "bun:test"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"

const runtime = ManagedRuntime.make(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer))

// Edit-shaped parameters: the top-level key the schema requires is `files`.
// The wrong-shape callers in t46/t56 sent `edits` (or `filePath`) at the top level.
const EditLike = Schema.Struct({
  files: Schema.Array(
    Schema.Struct({
      filePath: Schema.String,
      edits: Schema.optional(
        Schema.Array(
          Schema.Struct({
            fromHash: Schema.String,
            newString: Schema.String,
          }),
        ),
      ),
    }),
  ),
})

type Ctx = Tool.Context

function makeCtx(): Ctx {
  return {
    sessionID: SessionID.descending(),
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {
      return Effect.void
    },
    ask() {
      return Effect.void
    },
  }
}

async function makeExecute() {
  const info = await runtime.runPromise(
    Tool.define(
      "testeditlike",
      Effect.succeed({
        description: "test tool",
        parameters: EditLike,
        execute() {
          return Effect.succeed({ title: "test", output: "ok", metadata: { truncated: false } })
        },
      }),
    ),
  )
  const tool = await Effect.runPromise(info.init())
  return tool.execute as unknown as (args: unknown, ctx: Ctx) => Effect.Effect<unknown>
}

async function errorOf(execute: (args: unknown, ctx: Ctx) => Effect.Effect<unknown>, args: unknown, ctx: Ctx) {
  try {
    await Effect.runPromise(execute(args, ctx))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("execute unexpectedly succeeded")
}

describe("tool validation guard (t57)", () => {
  test("schema error names the received keys and shows a schema-derived example", async () => {
    const execute = await makeExecute()
    const message = await errorOf(execute, { edits: [{ fromHash: "abc", newString: "x" }] }, makeCtx())
    expect(message).toContain("edits")
    expect(message).toContain('"files"')
  })

  test("third consecutive identical rejection is a STALL refusal", async () => {
    const execute = await makeExecute()
    const ctx = makeCtx()
    const bad = { edits: [{ fromHash: "abc", newString: "x" }] }
    const first = await errorOf(execute, bad, ctx)
    const second = await errorOf(execute, bad, ctx)
    const third = await errorOf(execute, bad, ctx)
    expect(first).not.toContain("STALL")
    expect(second).not.toContain("STALL")
    expect(third).toContain("STALL")
    expect(third).toContain("3")
  })

  test("a different input resets the count and success clears it", async () => {
    const execute = await makeExecute()
    const ctx = makeCtx()
    const badA = { edits: [{ fromHash: "aaa", newString: "x" }] }
    const badB = { edits: [{ fromHash: "bbb", newString: "y" }] }
    await errorOf(execute, badA, ctx)
    await errorOf(execute, badA, ctx)
    const afterDifferent = await errorOf(execute, badB, ctx)
    expect(afterDifferent).not.toContain("STALL")
    await Effect.runPromise(execute({ files: [{ filePath: "src/a.ts" }] }, ctx))
    const afterSuccess = await errorOf(execute, badB, ctx)
    expect(afterSuccess).not.toContain("STALL")
  })
})
