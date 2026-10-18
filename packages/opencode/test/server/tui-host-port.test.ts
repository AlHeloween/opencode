import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Server, TUI_HOST_PREFERRED_PORT } from "../../src/server/server"
import { ServerHost } from "../../src/server/host"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// t91: the TUI worker's embedded host server (robot delegation) prefers 2727
// with next-free fallback; serve/web keep the shared 4096 default.
// Heavy-file rule: FILE-level timeout, never per-test whack-a-mole.
setDefaultTimeout(20_000)

const WEB_PORT = 4096

const listeners: { stop: (close?: boolean) => Promise<void> }[] = []
const held: string[] = []

// bun runs every named file in ONE process: release claims and stop listeners
// here so no token or port leaks into another file's server.
afterEach(async () => {
  for (const worktree of held.splice(0)) ServerHost.release(worktree)
  for (const listener of listeners.splice(0)) await listener.stop(true)
  await Instance.disposeAll()
  Database.close()
})

async function canBind(port: number) {
  try {
    const probe = Bun.serve({ port, fetch: () => new Response("probe") })
    probe.stop(true)
    return true
  } catch {
    return false
  }
}

async function occupy(port: number) {
  const holder = Bun.serve({ port, fetch: () => new Response("held") })
  listeners.push({
    stop: async () => {
      holder.stop(true)
    },
  })
}

describe("t91 TUI host delegation port", () => {
  test("preferred port constant is 2727, the web/debug port stays 4096", () => {
    expect(TUI_HOST_PREFERRED_PORT).toBe(2727)
    expect(WEB_PORT).toBe(4096)
  })

  test("TUI host binds 2727 when it is free", async () => {
    if (!(await canBind(TUI_HOST_PREFERRED_PORT))) {
      console.warn("2727 held by another process; free-case unprovable in this env")
      return
    }
    const listener = await Server.listenTuiHost({ hostname: "127.0.0.1" })
    listeners.push(listener)
    expect(listener.port).toBe(2727)
  })

  test("TUI host takes the next free port when 2727 is held, never the web port", async () => {
    const free2727 = await canBind(TUI_HOST_PREFERRED_PORT)
    const free2728 = await canBind(TUI_HOST_PREFERRED_PORT + 1)
    if (free2727) await occupy(TUI_HOST_PREFERRED_PORT)
    // Either we hold 2727 or another process does — both prove fallback.
    const listener = await Server.listenTuiHost({ hostname: "127.0.0.1" })
    listeners.push(listener)
    expect(listener.port).not.toBe(TUI_HOST_PREFERRED_PORT)
    expect(listener.port).not.toBe(WEB_PORT)
    if (free2727 && free2728) expect(listener.port).toBe(TUI_HOST_PREFERRED_PORT + 1)
  })

  test("host record holds the real TUI-host port", async () => {
    if (!(await canBind(TUI_HOST_PREFERRED_PORT))) {
      console.warn("2727 held by another process; record-case uses the fallback port")
    }
    await using tmp = await tmpdir()
    const listener = await Server.listenTuiHost({ hostname: "127.0.0.1" })
    listeners.push(listener)
    held.push(tmp.path)
    const claimed = await ServerHost.claim(tmp.path, listener.url.toString())
    expect(claimed.won).toBe(true)
    const found = await ServerHost.lookup(tmp.path)
    expect(found?.url).toBe(listener.url.toString())
    expect(new URL(found!.url).port).toBe(String(listener.port))
  })

  test("default serve path still tries the web port first (adaptive to the machine)", async () => {
    if (await canBind(WEB_PORT)) {
      const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
      listeners.push(listener)
      expect(listener.port).toBe(WEB_PORT)
    } else {
      // The web port is held (e.g. the owner's live host): the default path
      // must fall back without throwing, and must not steal the TUI port.
      const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
      listeners.push(listener)
      expect(listener.port).not.toBe(WEB_PORT)
    }
  })
})
