import { describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"

/**
 * Regression tests for the 2026-09-11 TUI black-screen defect.
 *
 * `Rpc.client().call()` returned a promise with no timeout and no reject path, so
 * a worker that never replied hung the caller forever. On the pre-render path
 * (`thread.ts` -> `fetch` / `server`) that produced a blank terminal with no
 * message at all. The optional `timeoutMs` must make such a call reject, while
 * omitting it must preserve the original unbounded behaviour.
 */
function fakeWorker() {
  const messages: string[] = []
  return {
    messages,
    postMessage: (data: string) => {
      messages.push(data)
    },
    onmessage: null as ((evt: { data: string }) => unknown) | null,
  }
}

describe("util.rpc", () => {
  test("call rejects when the worker never replies and a timeout is set", async () => {
    const worker = fakeWorker()
    const client = Rpc.client<{ ping: (input: undefined) => string }>(worker as any)

    const error = await client.call("ping", undefined, { timeoutMs: 25 }).then(
      () => undefined,
      (e) => e as Error,
    )

    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain("RPC call timed out after 25ms")
    expect(error!.message).toContain("ping")
  })

  test("call resolves normally when the worker replies before the timeout", async () => {
    const worker = fakeWorker()
    const client = Rpc.client<{ ping: (input: undefined) => string }>(worker as any)
    const promise = client.call("ping", undefined, { timeoutMs: 1_000 })

    const request = JSON.parse(worker.messages[0]!)
    worker.onmessage!({ data: JSON.stringify({ type: "rpc.result", result: "pong", id: request.id }) } as any)

    expect(await promise).toBe("pong")
  })

  test("call without a timeout stays pending (existing behaviour preserved)", async () => {
    const worker = fakeWorker()
    const client = Rpc.client<{ ping: (input: undefined) => string }>(worker as any)

    const settled = await Promise.race([
      client.call("ping", undefined).then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
    ])

    expect(settled).toBe("pending")
  })

  test("a late reply after timeout does not throw an unhandled rejection", async () => {
    const worker = fakeWorker()
    const client = Rpc.client<{ ping: (input: undefined) => string }>(worker as any)
    const promise = client.call("ping", undefined, { timeoutMs: 10 })
    const request = JSON.parse(worker.messages[0]!)

    await promise.catch(() => undefined)
    worker.onmessage!({ data: JSON.stringify({ type: "rpc.result", result: "late", id: request.id }) } as any)

    expect(true).toBe(true)
  })
})
