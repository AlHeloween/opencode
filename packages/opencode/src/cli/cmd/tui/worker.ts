import { Server } from "@/server/server"
import { ServerHost } from "@/server/host"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"

import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process"

ensureProcessMetadata("worker")

// The worker's own logs must follow the same knob as the host process:
// `--log-level` was previously ignored here, so worker logs could never be
// put into DEBUG (the flag only reached the root middleware).
const logLevelIndex = process.argv.indexOf("--log-level")
const logLevel = logLevelIndex >= 0 ? (process.argv[logLevelIndex + 1] as Log.Level | undefined) : undefined

await Log.init({
  print: process.argv.includes("--print-logs"),
  logLevel,
})

Heap.start()

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
  process.exit(1)
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
  process.exit(1)
})

// Subscribe to global events and forward them via RPC
const onGlobalEvent = (event: unknown) => {
  Rpc.emit("global.event", event)
}
GlobalBus.on("event", onGlobalEvent)

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

/**
 * One server per worktree DB (plans/2026-10-02_one-server-per-worktree.md). This worker is either the
 * worktree's HOST (its own Server, recorded in `server_host`) or a PROXY to the host another process
 * recorded: RPC fetches are forwarded there and its `/global/event` stream is re-emitted as
 * `global.event`. The TUI talks RPC either way and never learns which; when the proxied stream ends the
 * worker settles again — re-proxy to a new host, or take the host role itself.
 */
type Upstream = { url: string; token: string; abort: AbortController }
let upstream: Upstream | undefined
let worktree: string | undefined

async function settle() {
  const dir = worktree!
  const live = await ServerHost.lookup(dir)
  if (live && live.nonce !== ServerHost.nonce) return proxy(live)
  server ??= await Server.listen({ port: 0, hostname: "127.0.0.1" })
  const claimed = await ServerHost.claim(dir, server.url.toString())
  if (!claimed.won) {
    await server.stop(true)
    server = undefined
    return proxy(claimed.host)
  }
  upstream?.abort.abort()
  upstream = undefined
  Log.Default.info("worktree host: serving", { worktree: dir, url: claimed.host.url })
  return { mode: "host" as const, url: claimed.host.url, pid: process.pid }
}

function proxy(record: ServerHost.Record) {
  upstream?.abort.abort()
  const next = { url: record.url, token: record.token, abort: new AbortController() }
  upstream = next
  Log.Default.info("worktree host: proxying", { worktree, url: record.url, pid: record.pid })
  void follow(next)
  return { mode: "proxy" as const, url: record.url, pid: record.pid }
}

async function follow(up: Upstream) {
  await relay(up).catch((error) => {
    if (!up.abort.signal.aborted) Log.Default.warn("worktree host: stream failed", { url: up.url, error: errorText(error) })
  })
  if (up.abort.signal.aborted || upstream !== up) return
  Log.Default.warn("worktree host lost", { url: up.url })
  const result = await settle().catch((error) => {
    Log.Default.error("bug: worktree host takeover failed", { error: errorText(error) })
    return undefined
  })
  if (!result) return
  // The TUI's store was built from the lost host; make it re-read from whoever serves now.
  Rpc.emit("global.event", {
    directory: "global",
    payload: { type: "server.instance.disposed", properties: { directory: worktree } },
  })
}

async function relay(up: Upstream) {
  const res = await fetch(new URL("/global/event", up.url), {
    headers: { authorization: basic(up.token) },
    signal: up.abort.signal,
  })
  if (!res.ok || !res.body) throw new Error(`host event stream answered ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) return
    buffer += decoder.decode(chunk.value, { stream: true })
    const frames = buffer.split("\n\n")
    buffer = frames.pop() ?? ""
    frames
      .flatMap((frame) => frame.split("\n").filter((line) => line.startsWith("data:")))
      .forEach((line) => Rpc.emit("global.event", JSON.parse(line.slice(5).trim())))
  }
}

function basic(password: string) {
  return `Basic ${btoa(`${Flag.OPENCODE_SERVER_USERNAME ?? "opencode"}:${password}`)}`
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export const rpc = {
  async host(input: { directory: string }) {
    worktree = input.directory
    return settle()
  },
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    if (upstream) {
      const target = new URL(input.url)
      const base = new URL(upstream.url)
      target.protocol = base.protocol
      target.host = base.host
      headers["authorization"] ??= basic(upstream.token)
      const response = await fetch(target, { method: input.method, headers, body: input.body })
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      }
    }
    const auth = ServerHost.authorization()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[]; directory: string }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    worktree = input.directory
    const local = new URL(server.url)
    if (input.hostname === "0.0.0.0" || input.hostname === "::") local.hostname = "127.0.0.1"
    const claimed = await ServerHost.claim(input.directory, local.toString(), input.hostname)
    if (!claimed.won) {
      Log.Default.warn("worktree host already running; this explicit server is a second writer", {
        host: claimed.host.url,
      })
    }
    return { url: server.url.toString(), authorization: ServerHost.authorization() }
  },

  async reload() {
    await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.invalidate(true)))
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    GlobalBus.off("event", onGlobalEvent)
    const up = upstream
    upstream = undefined
    up?.abort.abort()
    if (worktree && ServerHost.holding()) ServerHost.release(worktree)
    await Instance.disposeAll()
    if (server) await server.stop(true)
  },
}

Rpc.listen(rpc)
