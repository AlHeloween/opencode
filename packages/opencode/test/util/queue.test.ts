import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("force push is delivered even when the queue is full", async () => {
    const q = new AsyncQueue<string | null>({ maxLength: 1 })
    q.push("event")
    q.push("dropped")
    q.push(null, { force: true })

    expect(await q.next()).toBe("event")
    expect(await q.next()).toBe(null)
  })
})
