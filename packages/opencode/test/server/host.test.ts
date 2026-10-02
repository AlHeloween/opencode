import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { existsSync } from "fs"
import path from "path"
import { ServerHost } from "../../src/server/host"
import { Server } from "../../src/server/server"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

// Spawns real child servers: bun's 5 s default says nothing about the code on a loaded machine.
setDefaultTimeout(60_000)

const worker = path.join(import.meta.dir, "..", "fixture", "host-worker.ts")
const children: Bun.Subprocess[] = []
const listeners: { stop: (close?: boolean) => Promise<void> }[] = []
const held: string[] = []

function claim(worktree: string, url: string) {
  held.push(worktree)
  return ServerHost.claim(worktree, url)
}

// bun runs every named file in ONE process: a claim left held here would put the token on every later file's server.
afterEach(async () => {
  for (const worktree of held.splice(0)) ServerHost.release(worktree)
  expect(ServerHost.holding()).toBe(false)
  for (const child of children.splice(0)) {
    child.kill()
    await child.exited
  }
  for (const listener of listeners.splice(0)) await listener.stop(true)
  Database.close()
})

type Claimed = { url: string; nonce: string; result: ServerHost.ClaimResult }

async function spawnHost(worktree: string) {
  // process.execPath, never "bun": on Windows `bun` on PATH is the npm shim `bun.cmd`, so `kill()` in afterEach
  // reached cmd.exe and the real bun.exe host worker outlived the suite (measured 2026-10-02: 3 orphans per run).
  const child = Bun.spawn([process.execPath, "run", "--conditions=browser", worker, worktree], {
    cwd: path.join(import.meta.dir, "..", ".."),
    stdout: "pipe",
    stderr: "inherit",
  })
  children.push(child)
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let text = ""
  while (!text.includes("\n")) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error(`host worker exited before claiming: ${text}`)
    text += decoder.decode(chunk.value)
  }
  return JSON.parse(text.slice(0, text.indexOf("\n"))) as Claimed
}

async function listen() {
  const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
  listeners.push(listener)
  return listener.url.toString()
}

function writeRecord(worktree: string, row: { url: string; pid: number; nonce: string }) {
  const db = new Sqlite(Database.getProjectDbPath(worktree))
  db.query(
    `insert into server_host (id, url, pid, nonce, token, time_started) values ('host', ?, ?, ?, 'stale-token', ?)
     on conflict(id) do update set url = excluded.url, pid = excluded.pid, nonce = excluded.nonce, token = excluded.token`,
  ).run(row.url, row.pid, row.nonce, Date.now())
  db.close()
}

describe("ServerHost", () => {
  test("lookup on a worktree with no database answers undefined and creates nothing", async () => {
    await using tmp = await tmpdir()
    expect(await ServerHost.lookup(tmp.path)).toBeUndefined()
    expect(existsSync(Database.getProjectDbPath(tmp.path))).toBe(false)
  })

  test("health echoes this process's nonce", async () => {
    const url = await listen()
    const health = (await fetch(new URL("/global/health", url)).then((r) => r.json())) as Record<string, unknown>
    expect(health.host).toBe(ServerHost.nonce)
    expect(JSON.stringify(health)).not.toContain(ServerHost.token)
  })

  test("a claim by a live server is found by lookup; release clears it", async () => {
    await using tmp = await tmpdir()
    const url = await listen()
    const claimed = await claim(tmp.path, url)
    expect(claimed.won).toBe(true)
    expect(claimed.host).toMatchObject({ url, pid: process.pid, nonce: ServerHost.nonce, token: ServerHost.token })
    expect(ServerHost.token).toMatch(/^[0-9a-f]{64}$/)

    expect(await ServerHost.lookup(tmp.path)).toMatchObject({ url, nonce: ServerHost.nonce, token: ServerHost.token })

    ServerHost.release(tmp.path)
    expect(await ServerHost.lookup(tmp.path)).toBeUndefined()
  })

  test("a record whose url is dead is stale: lookup skips it and a claim replaces it", async () => {
    await using tmp = await tmpdir()
    const url = await listen()
    await claim(tmp.path, url)
    writeRecord(tmp.path, { url: "http://127.0.0.1:9/", pid: 999_999, nonce: "crashed" })

    expect(await ServerHost.lookup(tmp.path)).toBeUndefined()
    const claimed = await claim(tmp.path, url)
    expect(claimed.won).toBe(true)
    expect(claimed.host.nonce).toBe(ServerHost.nonce)
  })

  test("a live server that echoes a DIFFERENT nonce is stale — another worktree's host on a reused port", async () => {
    await using tmp = await tmpdir()
    const url = await listen()
    await claim(tmp.path, url)
    writeRecord(tmp.path, { url, pid: process.pid, nonce: "before-reboot" })

    expect(await ServerHost.lookup(tmp.path)).toBeUndefined()
  })

  test("a second process cannot claim over a live host; it gets the host back", async () => {
    await using tmp = await tmpdir()
    const first = await spawnHost(tmp.path)
    expect(first.result.won).toBe(true)

    const url = await listen()
    const second = await claim(tmp.path, url)
    expect(second.won).toBe(false)
    expect(second.host).toMatchObject({ url: first.url, nonce: first.nonce })
    expect(await ServerHost.lookup(tmp.path)).toMatchObject({ url: first.url, nonce: first.nonce })
  })

  test("two processes racing over a stale record: exactly one wins, the loser names the winner", async () => {
    await using tmp = await tmpdir()
    const url = await listen()
    await claim(tmp.path, url)
    writeRecord(tmp.path, { url: "http://127.0.0.1:9/", pid: 999_999, nonce: "crashed" })

    const [a, b] = await Promise.all([spawnHost(tmp.path), spawnHost(tmp.path)])
    expect([a.result.won, b.result.won].filter(Boolean)).toHaveLength(1)
    const winner = a.result.won ? a : b
    const loser = a.result.won ? b : a
    expect(loser.result.host).toMatchObject({ url: winner.url, nonce: winner.nonce })
  })
})
