import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { ServerHost } from "../../src/server/host"
import { Server } from "../../src/server/server"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(60_000)

const listeners: { stop: (close?: boolean) => Promise<void> }[] = []
const held: string[] = []

// bun runs every named file in ONE process: a claim left held here would put the token on every later file's server.
afterEach(async () => {
  for (const worktree of held.splice(0)) ServerHost.release(worktree)
  for (const listener of listeners.splice(0)) await listener.stop(true)
  await Instance.disposeAll()
  Database.close()
})

async function firstEvent(stream: AsyncIterable<unknown>) {
  const timeout = Bun.sleep(5_000).then(() => "no event within 5 s")
  const first = (async () => {
    for await (const event of stream) return (event as { type: string }).type
    return "stream ended"
  })()
  return Promise.race([first, timeout])
}

describe("a client attached through the host record", () => {
  test("receives the host's per-instance event stream (what `run` waits on for turn end)", async () => {
    await using tmp = await tmpdir({ git: true })
    const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
    listeners.push(listener)
    held.push(tmp.path)
    await ServerHost.claim(tmp.path, listener.url.toString())

    const host = await ServerHost.lookup(tmp.path)
    expect(host).toBeDefined()
    const abort = new AbortController()
    const sdk = createOpencodeClient({
      baseUrl: host!.url,
      directory: tmp.path,
      headers: { Authorization: `Basic ${btoa(`opencode:${host!.token}`)}` },
      signal: abort.signal,
    })
    const events = await sdk.event.subscribe()
    expect(await firstEvent(events.stream)).toBe("server.connected")
    abort.abort()
  })
})
