import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import {
  NEVER_BIND_PORTS,
  Server,
  TUI_HOST_PORT_BASE,
  TUI_HOST_PORT_MAX,
  TUI_HOST_PORT_MIN,
} from "../../src/server/server"
import { ServerHost } from "../../src/server/host"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

// t91/t92: the TUI worker's embedded host server (robot delegation) lives in
// the IANA-unassigned range 29170-29998, base 29200, next-free inside the range
// only (prior base dropped as IANA-registered). serve/web keep the shared 4096
// default. NEVER_BIND_PORTS (OAuth callbacks, infra, web/debug) is never
// bound, probed or claimed — plans/2026-10-18_codex-oauth-empty-error.md:31-35.
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

describe("t91/t92 delegation port 29200", () => {
  test("base and range constants pin the IANA-unassigned range", () => {
    expect(TUI_HOST_PORT_MIN).toBe(29170)
    expect(TUI_HOST_PORT_BASE).toBe(29200)
    expect(TUI_HOST_PORT_MAX).toBe(29998)
  })

  test("NEVER_BIND_PORTS holds the OAuth/infra/web set exactly once", () => {
    expect([...NEVER_BIND_PORTS].sort((a, b) => a - b)).toEqual([
      1455, 1456, 3005, 3010, 4096, 5432, 8079, 9222, 54545, 56121,
    ])
  })

  test("the delegation range never touches a forbidden port", () => {
    for (const port of NEVER_BIND_PORTS) {
      expect(port < TUI_HOST_PORT_MIN || port > TUI_HOST_PORT_MAX).toBe(true)
    }
  })

  test("TUI host binds the base port when it is free", async () => {
    if (!(await canBind(TUI_HOST_PORT_BASE))) {
      console.warn("29200 held by another process; free-case unprovable in this env")
      return
    }
    const listener = await Server.listenTuiHost({ hostname: "127.0.0.1" })
    listeners.push(listener)
    expect(listener.port).toBe(29200)
  })

  test("TUI host takes the next free port inside the range, never a forbidden one", async () => {
    const freeBase = await canBind(TUI_HOST_PORT_BASE)
    const freeNext = await canBind(TUI_HOST_PORT_BASE + 1)
    if (freeBase) await occupy(TUI_HOST_PORT_BASE)
    // Either we hold the base or another process does — both prove fallback.
    const listener = await Server.listenTuiHost({ hostname: "127.0.0.1" })
    listeners.push(listener)
    expect(listener.port).not.toBe(TUI_HOST_PORT_BASE)
    expect(listener.port).toBeGreaterThanOrEqual(TUI_HOST_PORT_MIN)
    expect(listener.port).toBeLessThanOrEqual(TUI_HOST_PORT_MAX)
    expect(NEVER_BIND_PORTS).not.toContain(listener.port)
    if (freeBase && freeNext) expect(listener.port).toBe(TUI_HOST_PORT_BASE + 1)
  })

  test("host record holds the real TUI-host port", async () => {
    if (!(await canBind(TUI_HOST_PORT_BASE))) {
      console.warn("29200 held by another process; record-case uses the fallback port")
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
      // must fall back without throwing, and must not steal the delegation port.
      const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
      listeners.push(listener)
      expect(listener.port).not.toBe(WEB_PORT)
    }
  })
})
