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

  /**
   * 2026-10-10 regression: `Rpc.listen`'s `onmessage` is async and nobody holds its promise, so a
   * rejecting handler escaped as `unhandledRejection` — which the TUI worker answers with
   * `process.exit(1)` (`cli/cmd/tui/worker.ts`). ONE failed proxied fetch therefore killed the whole
   * TUI transport while the host server kept serving: empty TUI, healthy server.
   *
   * A rejecting handler must become an `rpc.error` reply the caller can read, and must never reject
   * the (unobserved) `onmessage` promise.
   */
  test("a rejecting handler replies rpc.error instead of escaping as a rejection", async () => {
    const replies: string[] = []
    const original = {
      postMessage: globalThis.postMessage,
      onmessage: (globalThis as any).onmessage,
    }

    globalThis.postMessage = ((data: string) => {
      replies.push(data)
    }) as unknown as typeof postMessage

    try {
      Rpc.listen({
        boom: async () => {
          throw new Error("upstream unreachable")
        },
      } as any)

      const handler = (globalThis as any).onmessage as (evt: { data: string }) => unknown
      const returned = handler({
        data: JSON.stringify({ type: "rpc.request", method: "boom", input: undefined, id: 7 }),
      }) as Promise<unknown>

      // The unobserved promise must RESOLVE. A rejection here is the whole defect: nothing awaits
      // `onmessage`, so it becomes `unhandledRejection`, which the worker answers with exit(1).
      expect(
        await returned.then(
          () => "resolved",
          () => "REJECTED",
        ),
      ).toBe("resolved")

      const reply = JSON.parse(replies[0]!)
      expect(reply.type).toBe("rpc.error")
      expect(reply.id).toBe(7)
      expect(reply.error).toContain("upstream unreachable")
    } finally {
      globalThis.postMessage = original.postMessage
      ;(globalThis as any).onmessage = original.onmessage
    }
  })

  test("client rejects with the worker's error message", async () => {
    const worker = fakeWorker()
    const client = Rpc.client<{ ping: (input: undefined) => string }>(worker as any)
    const promise = client.call("ping", undefined)
    const request = JSON.parse(worker.messages[0]!)

    worker.onmessage!({
      data: JSON.stringify({ type: "rpc.error", id: request.id, error: "upstream unreachable" }),
    } as any)

    const error = await promise.then(
      () => undefined,
      (e) => e as Error,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error!.message).toContain("upstream unreachable")
  })
})
