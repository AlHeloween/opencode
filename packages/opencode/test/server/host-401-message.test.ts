import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { FilePaths } from "../../src/server/routes/instance/httpapi/file"
import { Server } from "../../src/server/server"
import { ServerHost } from "../../src/server/host"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init()
setDefaultTimeout(60_000)

/**
 * 2026-10-13 — a request without credentials to a worktree host answered a bare 401: text
 * `Unauthorized` on the socket layer (hono `basicAuth` through `server/middleware.ts`, measured
 * against the owner's live host) and `{"_tag":"Unauthorized","message":"Unauthorized"}` on the
 * Effect layer (`httpapi/auth.ts`, the bridged mounts). A reader could not tell «no credential»
 * from «broken server», and nothing pointed at the permitted client — `tools/opencode_host.py`.
 *
 * This file pins the required 401 on BOTH layers: it names the scheme (Basic), the username the
 * host expects, where the per-start token lives (the worktree DB table `server_host`) and the
 * permitted client; missing and wrong credentials answer identically; a correct credential is
 * unchanged; and no value read from `server_host` ever appears in the body.
 */

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

type UnauthorizedBody = { _tag?: string; message?: string }

/** Every 401 must name the four facts — never a value. */
function namesTheRoute(body: UnauthorizedBody, username: string) {
  expect(body._tag).toBe("Unauthorized")
  const message = body.message ?? ""
  expect(message).toContain("Basic")
  expect(message).toContain(`"${username}"`)
  expect(message).toContain("server_host")
  expect(message).toContain("opencode_host.py")
  expect(message).toContain("connect(<worktree>)")
}

const basic = (secret: string, username = "opencode") => `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`

const listeners: { stop: (close?: boolean) => Promise<void> }[] = []
const held: string[] = []

afterEach(async () => {
  for (const worktree of held.splice(0)) ServerHost.release(worktree)
  expect(ServerHost.holding()).toBe(false)
  for (const listener of listeners.splice(0)) await listener.stop(true)
  Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", original.OPENCODE_EXPERIMENTAL_HTTPAPI)
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await resetDatabase()
})

async function listen() {
  const listener = await Server.listen({ port: 0, hostname: "127.0.0.1" })
  listeners.push(listener)
  return listener.url
}

function claim(worktree: string, url: URL) {
  held.push(worktree)
  return ServerHost.claim(worktree, url.toString())
}

describe("the host 401 names the missing credential and the permitted route", () => {
  describe("socket layer (Server.listen + AuthMiddleware)", () => {

    test("a missing or wrong credential names the route; a correct one is unchanged", async () => {
      await using tmp = await tmpdir({ git: true })
      const url = await listen()
      await claim(tmp.path, url)
      const record = await ServerHost.lookup(tmp.path)
      expect(record?.token).toBe(ServerHost.token)
      const route = new URL(`/session?directory=${encodeURIComponent(tmp.path)}`, url)

      const missing = await fetch(route)
      expect(missing.status).toBe(401)
      expect(missing.headers.get("www-authenticate") ?? "").toStartWith("Basic")
      const missingBody = (await missing.json()) as UnauthorizedBody
      namesTheRoute(missingBody, "opencode")

      const wrong = await fetch(route, { headers: { authorization: basic("wrong") } })
      expect(wrong.status).toBe(401)
      expect(await wrong.json()).toEqual(missingBody)

      // No value read from `server_host` (and no filesystem path) may appear in the body.
      const body = JSON.stringify(missingBody)
      expect(body).not.toContain(record!.token)
      expect(body).not.toContain(record!.nonce)
      expect(body).not.toContain(String(record!.pid))
      expect(body).not.toContain(tmp.path)

      const good = await fetch(route, { headers: { authorization: basic(record!.token) } })
      expect(good.status).toBe(200)
      expect(Array.isArray(await good.json())).toBe(true)
    })

    test("the 401 names the username the host actually expects", async () => {
      await using tmp = await tmpdir({ git: true })
      Flag.OPENCODE_SERVER_USERNAME = "boss"
      const url = await listen()
      await claim(tmp.path, url)

      const res = await fetch(new URL(`/session?directory=${encodeURIComponent(tmp.path)}`, url))
      expect(res.status).toBe(401)
      const body = (await res.json()) as UnauthorizedBody
      namesTheRoute(body, "boss")
    })
  })

  describe("bridge layer (InstanceRoutes + Effect Authorization middleware)", () => {

    function bridged() {
      Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", true)
      Flag.OPENCODE_SERVER_PASSWORD = "secret"
      Flag.OPENCODE_SERVER_USERNAME = undefined
      return InstanceRoutes()
    }

    function fileUrl() {
      const url = new URL(`http://localhost${FilePaths.content}`)
      url.searchParams.set("path", "hello.txt")
      return url
    }

    test("a missing or wrong credential names the route; a correct one is unchanged", async () => {
      await using tmp = await tmpdir({ git: true })
      await Bun.write(`${tmp.path}/hello.txt`, "hello")
      const app = bridged()
      const url = fileUrl()
      const directory = { "x-opencode-directory": tmp.path }

      const missing = await app.request(url, { headers: directory })
      expect(missing.status).toBe(401)
      const missingBody = (await missing.json()) as UnauthorizedBody
      namesTheRoute(missingBody, "opencode")
      expect(JSON.stringify(missingBody)).not.toContain("secret")

      const wrong = await app.request(url, { headers: { authorization: basic("wrong"), ...directory } })
      expect(wrong.status).toBe(401)
      expect(await wrong.json()).toEqual(missingBody)

      const good = await app.request(url, {
        headers: { authorization: basic("secret"), ...directory },
      })
      expect(good.status).toBe(200)
      expect(await good.json()).toMatchObject({ content: "hello" })
    })
  })
})
