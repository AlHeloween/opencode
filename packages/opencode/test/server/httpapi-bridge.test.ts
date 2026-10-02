import { afterEach, describe, expect, test } from "bun:test"
import type { UpgradeWebSocket } from "hono/ws"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Instance } from "../../src/project/instance"
import { InstanceRoutes } from "../../src/server/routes/instance"
import { WorkspaceRoutes } from "../../src/server/routes/control/workspace"
import { ConfigApi } from "../../src/server/routes/instance/httpapi/config"
import { EventPaths } from "../../src/server/routes/instance/httpapi/event"
import { ExperimentalApi } from "../../src/server/routes/instance/httpapi/experimental"
import { FileApi, FilePaths } from "../../src/server/routes/instance/httpapi/file"
import { InstanceApi } from "../../src/server/routes/instance/httpapi/instance"
import { McpApi } from "../../src/server/routes/instance/httpapi/mcp"
import { PermissionApi } from "../../src/server/routes/instance/httpapi/permission"
import { ProjectApi } from "../../src/server/routes/instance/httpapi/project"
import { ProviderApi } from "../../src/server/routes/instance/httpapi/provider"
import { PtyApi, PtyPaths } from "../../src/server/routes/instance/httpapi/pty"
import { QuestionApi } from "../../src/server/routes/instance/httpapi/question"
import { SessionApi } from "../../src/server/routes/instance/httpapi/session"
import { SyncApi } from "../../src/server/routes/instance/httpapi/sync"
import { TuiApi } from "../../src/server/routes/instance/httpapi/tui"
import { WorkspaceApi } from "../../src/server/routes/instance/httpapi/workspace"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"
import { Server } from "../../src/server/server"
import * as Log from "@opencode-ai/core/util/log"
import { HttpApi, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init()

const original = {
  OPENCODE_EXPERIMENTAL_HTTPAPI: Flag.OPENCODE_EXPERIMENTAL_HTTPAPI,
  OPENCODE_SERVER_PASSWORD: Flag.OPENCODE_SERVER_PASSWORD,
  OPENCODE_SERVER_USERNAME: Flag.OPENCODE_SERVER_USERNAME,
}

const websocket = (() => () => new Response(null, { status: 501 })) as unknown as UpgradeWebSocket
const methods = ["get", "post", "put", "delete", "patch"] as const

function app(input?: { password?: string; username?: string }) {
  Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", true)
  Flag.OPENCODE_SERVER_PASSWORD = input?.password
  Flag.OPENCODE_SERVER_USERNAME = input?.username
  return InstanceRoutes()
}

function routeKey(route: ReturnType<typeof InstanceRoutes>["routes"][number]) {
  return `${route.method} ${route.path}`
}

function reflectedHttpApiRoutes() {
  const routes = [`GET ${EventPaths.event}`, `GET ${PtyPaths.connect}`]

  function addRoutes<Id extends string, Groups extends HttpApiGroup.Any>(api: HttpApi.HttpApi<Id, Groups>) {
    HttpApi.reflect(api, {
      onGroup() {},
      onEndpoint({ endpoint }) {
        routes.push(`${endpoint.method} ${endpoint.path}`)
      },
    })
  }

  addRoutes(ConfigApi)
  addRoutes(ExperimentalApi)
  addRoutes(FileApi)
  addRoutes(InstanceApi)
  addRoutes(McpApi)
  addRoutes(PermissionApi)
  addRoutes(ProjectApi)
  addRoutes(ProviderApi)
  addRoutes(PtyApi)
  addRoutes(QuestionApi)
  addRoutes(SessionApi)
  addRoutes(SyncApi)
  addRoutes(TuiApi)
  addRoutes(WorkspaceApi)

  return [...new Set(routes)]
}

function openApiRouteKeys(spec: { paths: Record<string, Partial<Record<(typeof methods)[number], unknown>>> }) {
  return Object.entries(spec.paths)
    .flatMap(([path, item]) =>
      methods.filter((method) => item[method]).map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort()
}

function authorization(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function fileUrl(input?: { directory?: string; token?: string }) {
  const url = new URL(`http://localhost${FilePaths.content}`)
  url.searchParams.set("path", "hello.txt")
  if (input?.directory) url.searchParams.set("directory", input.directory)
  if (input?.token) url.searchParams.set("auth_token", input.token)
  return url
}

afterEach(async () => {
  Flag._setTest("OPENCODE_EXPERIMENTAL_HTTPAPI", original.OPENCODE_EXPERIMENTAL_HTTPAPI)
  Flag.OPENCODE_SERVER_PASSWORD = original.OPENCODE_SERVER_PASSWORD
  Flag.OPENCODE_SERVER_USERNAME = original.OPENCODE_SERVER_USERNAME
  await Instance.disposeAll()
  await resetDatabase()
})

describe("HttpApi Hono bridge", () => {
  // InstanceRoutes no longer splits into "bridge + legacy tail": 4a9eea22e4 removed the
  // OPENCODE_EXPERIMENTAL_HTTPAPI gate and 2481637696 (api-v2 1.7) deleted the legacy instance routes,
  // so slicing the flag-on app by the flag-off length left an empty bridge. The instance app IS the mount set.
  test("mounts an HttpApi handler for every legacy workspace route", () => {
    const mounted = new Set(InstanceRoutes().routes.map(routeKey))
    // WorkspaceRoutes is the remaining legacy Hono app, mounted by Server.create() behind the bridged handlers.
    const legacyRoutes = [
      ...new Set(
        WorkspaceRoutes().routes.map(
          (route) => `${route.method} /experimental/workspace${route.path === "/" ? "" : route.path}`,
        ),
      ),
    ]

    expect(legacyRoutes.length).toBeGreaterThan(0)
    expect(legacyRoutes.filter((route) => !mounted.has(route))).toEqual([])
  })

  // InstanceApi routes (/path, /vcs, /agent, ...) are served by native describeRoute handlers since
  // 2cfeaf25d1; every other HttpApi route reaches the Effect handler through the bridge.
  test("mounts every Effect HttpApi route on the instance app", () => {
    const mounted = new Set(InstanceRoutes().routes.map(routeKey))
    const httpApiRoutes = reflectedHttpApiRoutes()

    expect(httpApiRoutes.filter((route) => !mounted.has(route))).toEqual([])
    expect([...mounted].filter((route) => !httpApiRoutes.includes(route)).sort()).toEqual([])
  })

  test("covers every generated OpenAPI route with Effect HttpApi contracts", async () => {
    const honoRoutes = openApiRouteKeys(await Server.openapi())
    const effectRoutes = openApiRouteKeys(OpenApi.fromApi(PublicApi))

    expect(honoRoutes.filter((route) => !effectRoutes.includes(route))).toEqual([])
    expect(effectRoutes.filter((route) => !honoRoutes.includes(route))).toEqual([])
  })

  test("allows requests when auth is disabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app().request(fileUrl(), {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "hello" })
  })

  test("provides instance context to bridged handlers", async () => {
    await using tmp = await tmpdir({ git: true })

    const response = await app().request("/project/current", {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ worktree: tmp.path })
  })

  test("requires credentials when auth is enabled", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const [missing, bad, good] = await Promise.all([
      app({ password: "secret" }).request(fileUrl(), {
        headers: { "x-opencode-directory": tmp.path },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "wrong"),
          "x-opencode-directory": tmp.path,
        },
      }),
      app({ password: "secret" }).request(fileUrl(), {
        headers: {
          authorization: authorization("opencode", "secret"),
          "x-opencode-directory": tmp.path,
        },
      }),
    ])

    expect(missing.status).toBe(401)
    expect(bad.status).toBe(401)
    expect(good.status).toBe(200)
  })

  test("accepts auth_token query credentials", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(`${tmp.path}/hello.txt`, "hello")

    const response = await app({ password: "secret" }).request(
      fileUrl({ token: Buffer.from("opencode:secret").toString("base64") }),
      {
        headers: {
          "x-opencode-directory": tmp.path,
        },
      },
    )

    expect(response.status).toBe(200)
  })

  test("selects instance from query before directory header", async () => {
    await using header = await tmpdir({ git: true })
    await using query = await tmpdir({ git: true })
    await Bun.write(`${header.path}/hello.txt`, "header")
    await Bun.write(`${query.path}/hello.txt`, "query")

    const response = await app().request(fileUrl({ directory: query.path }), {
      headers: {
        "x-opencode-directory": header.path,
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ content: "query" })
  })
})
