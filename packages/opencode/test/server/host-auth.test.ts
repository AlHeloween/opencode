import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { ServerHost } from "../../src/server/host"
import { Server } from "../../src/server/server"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

setDefaultTimeout(60_000)

const listeners: { stop: (close?: boolean) => Promise<void> }[] = []
const held: string[] = []

function claim(worktree: string, url: URL) {
  held.push(worktree)
  return ServerHost.claim(worktree, url.toString())
}

// bun runs every named file in ONE process: a claim left held here would put the token on every later file's server.
afterEach(async () => {
  for (const worktree of held.splice(0)) ServerHost.release(worktree)
  expect(ServerHost.holding()).toBe(false)
  for (const listener of listeners.splice(0)) await listener.stop(true)
  await Instance.disposeAll()
  Database.close()
})

async function listen() {
  const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
  listeners.push(listener)
  return listener.url
}

const basic = (secret: string) => `Basic ${Buffer.from(`opencode:${secret}`).toString("base64")}`

describe("host command channel", () => {
  test("a process that holds no host record stays open, as before", async () => {
    await using tmp = await tmpdir({ git: true })
    const url = await listen()
    const res = await fetch(new URL(`/session?directory=${encodeURIComponent(tmp.path)}`, url))
    expect(res.status).toBe(200)
  })

  test("a host requires its record's token on command routes; health stays open and token-free", async () => {
    await using tmp = await tmpdir({ git: true })
    const url = await listen()
    await claim(tmp.path, url)
    const record = await ServerHost.lookup(tmp.path)
    expect(record?.token).toBe(ServerHost.token)
    const route = new URL(`/session?directory=${encodeURIComponent(tmp.path)}`, url)

    expect((await fetch(route)).status).toBe(401)
    expect((await fetch(route, { headers: { authorization: basic("wrong") } })).status).toBe(401)
    expect((await fetch(route, { headers: { authorization: basic(record!.token) } })).status).toBe(200)

    const health = await fetch(new URL("/global/health", url))
    expect(health.status).toBe(200)
    expect(await health.text()).not.toContain(ServerHost.token)

    ServerHost.release(tmp.path)
    expect((await fetch(route)).status).toBe(200)
  })

  test("a loopback host refuses a foreign Host header (DNS rebinding) even with the token", async () => {
    await using tmp = await tmpdir({ git: true })
    const url = await listen()
    await claim(tmp.path, url)
    const app = Server.Default().app
    const headers = { authorization: basic(ServerHost.token) }
    const path = `/session?directory=${encodeURIComponent(tmp.path)}`

    expect((await app.fetch(new Request(`http://evil.example${path}`, { headers }))).status).toBe(403)
    expect((await app.fetch(new Request(`http://evil.example/global/health`))).status).toBe(403)
    expect((await app.fetch(new Request(`http://127.0.0.1:${url.port}${path}`, { headers }))).status).toBe(200)
    expect((await app.fetch(new Request(`http://localhost:${url.port}${path}`, { headers }))).status).toBe(200)
    expect((await app.fetch(new Request(`http://opencode.internal${path}`, { headers }))).status).toBe(200)
    ServerHost.release(tmp.path)
  })
})
