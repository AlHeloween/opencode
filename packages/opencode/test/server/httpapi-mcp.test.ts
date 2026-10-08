import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Context, Effect, Layer } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Flag } from "@opencode-ai/core/flag/flag"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { McpPaths } from "../../src/server/routes/instance/httpapi/mcp"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { provideTmpdirInstance, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init()

// Config load auto-injects mcp.codegraph whenever the worktree has .codegraph/ or
// `codegraph` is on PATH (config/codegraph-mcp-auto.ts) — true on this host. The injected
// server joins the status map (breaking the { demo: … } expectation below) and its child
// process holds the scoped temp dir (EBUSY on rm). These tests own their MCP config, so
// they opt out — same pattern as test/mcp/lifecycle.test.ts. The live case below also gets
// its scoped temp dir held on win32 by the file watcher (EBUSY on rm) — disabled there,
// same as test/server/session-messages.test.ts.
const codegraphMcpEnv = process.env.OPENCODE_CODEGRAPH_MCP
const fileWatcherEnv = process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
beforeAll(() => {
  process.env.OPENCODE_CODEGRAPH_MCP = "0"
  if (process.platform === "win32") process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = "true"
})
afterAll(() => {
  if (codegraphMcpEnv === undefined) delete process.env.OPENCODE_CODEGRAPH_MCP
  else process.env.OPENCODE_CODEGRAPH_MCP = codegraphMcpEnv
  if (fileWatcherEnv === undefined) delete process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER
  else process.env.OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER = fileWatcherEnv
})

const original = Flag.OPENCODE_EXPERIMENTAL_HTTPAPI
const context = Context.empty() as Context.Context<unknown>
const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket
const it = testEffect(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, CrossSpawnSpawner.defaultLayer))

function app(experimental: boolean) {
  Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", experimental)

  return InstanceRoutes()
}

function request(route: string, directory: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("x-opencode-directory", directory)
  return ExperimentalHttpApiServer.webHandler().handler(
    new Request(`http://localhost${route}`, {
      ...init,
      headers,
    }),
    context,
  )
}

// `provideTmpdirInstance` (test/fixture/fixture.ts) is the fixture that already solved this
// class on Windows: the scoped dir is cleaned with retries (EBUSY) and the process-global
// logger is re-pointed off the removed worktree before the scope closes. The hand-rolled
// makeTempDirectoryScoped version lost that cleanup — measured EBUSY on rm.
function withMcpProject<A, E, R>(self: (dir: string) => Effect.Effect<A, E, R>) {
  return provideTmpdirInstance(self, {
    config: {
      formatter: false,
      lsp: false,
      mcp: {
        demo: {
          type: "local" as const,
          command: ["echo", "demo"],
          enabled: false,
        },
      },
    },
  })
}

const readResponse = Effect.fnUntraced(function* (input: {
  app: ReturnType<typeof InstanceRoutes>
  path: string
  headers: HeadersInit
}) {
  const response = yield* Effect.promise(() =>
    Promise.resolve(input.app.request(input.path, { method: "POST", headers: input.headers })),
  )
  return {
    status: response.status,
    body: yield* Effect.promise(() => response.text()),
  }
})

afterEach(async () => {
  Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", original)

  await Instance.disposeAll()
  await resetDatabase()
})

describe("mcp HttpApi", () => {
  test("serves status endpoint", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const response = await request(McpPaths.status, tmp.path)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ demo: { status: "disabled" } })
  })

  test("serves add, connect, and disconnect endpoints", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const added = await request(McpPaths.status, tmp.path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "added",
        config: {
          type: "local",
          command: ["echo", "added"],
          enabled: false,
        },
      }),
    })
    expect(added.status).toBe(200)
    expect(await added.json()).toMatchObject({ added: { status: "disabled" } })

    const connected = await request("/mcp/demo/connect", tmp.path, { method: "POST" })
    expect(connected.status).toBe(200)
    expect(await connected.json()).toBe(true)

    const disconnected = await request("/mcp/demo/disconnect", tmp.path, { method: "POST" })
    expect(disconnected.status).toBe(200)
    expect(await disconnected.json()).toBe(true)
  })

  test("serves deterministic OAuth endpoints", async () => {
    await using tmp = await tmpdir({
      config: {
        mcp: {
          demo: {
            type: "local",
            command: ["echo", "demo"],
            enabled: false,
          },
        },
      },
    })

    const start = await request("/mcp/demo/auth", tmp.path, { method: "POST" })
    expect(start.status).toBe(400)

    const authenticate = await request("/mcp/demo/auth/authenticate", tmp.path, { method: "POST" })
    expect(authenticate.status).toBe(400)

    const removed = await request("/mcp/demo/auth", tmp.path, { method: "DELETE" })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ success: true })
  })

  it.live(
    "matches legacy unsupported OAuth error responses",
    withMcpProject((dir) =>
      Effect.gen(function* () {
        const headers = { "x-opencode-directory": dir }
        const legacy = app(false)
        const httpapi = app(true)

        yield* Effect.forEach(["/mcp/demo/auth", "/mcp/demo/auth/authenticate"], (path) =>
          Effect.gen(function* () {
            const legacyResponse = yield* readResponse({ app: legacy, path, headers })
            const httpapiResponse = yield* readResponse({ app: httpapi, path, headers })

            expect(legacyResponse).toEqual({
              status: 400,
              body: JSON.stringify({ error: "MCP server demo does not support OAuth" }),
            })
            expect(httpapiResponse).toEqual(legacyResponse)
          }),
        )
      }),
    ),
  )
})
