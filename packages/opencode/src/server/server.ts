import { generateSpecs } from "hono-openapi"
import { Hono } from "hono"
import { adapter } from "#hono"
import { lazy } from "@/util/lazy"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { WorkspaceID } from "@/control-plane/schema"
import { MDNS } from "./mdns"
import { AuthMiddleware, CompressionMiddleware, CorsMiddleware, ErrorMiddleware, LoggerMiddleware } from "./middleware"
import { FenceMiddleware } from "./fence"
import { initProjectors } from "./projectors"
import { InstanceRoutes } from "./routes/instance"
import { ControlPlaneRoutes } from "./routes/control"
import { UIRoutes } from "./routes/ui"
import { GlobalRoutes } from "./routes/global"
import { WorkspaceRouterMiddleware } from "./workspace"
import { InstanceMiddleware } from "./routes/instance/middleware"
import { WorkspaceRoutes } from "./routes/control/workspace"
import { ExperimentalHttpApiServer } from "./routes/instance/httpapi/server"
import { WorkspacePaths } from "./routes/instance/httpapi/workspace"
import { Context } from "effect"
import { OpenApi } from "effect/unstable/httpapi"

// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false

initProjectors()

const log = Log.create({ service: "server" })

export type Listener = {
  hostname: string
  port: number
  url: URL
  stop: (close?: boolean) => Promise<void>
}

export const Default = lazy(() => create({}))

function create(opts: { cors?: string[] }) {
  const app = new Hono()
    .onError(ErrorMiddleware)
    .use(AuthMiddleware)
    .use(LoggerMiddleware)
    .use(CompressionMiddleware)
    .use(CorsMiddleware(opts))
    .route("/global", GlobalRoutes())

  const runtime = adapter.create(app)

  if (Flag.OPENCODE_WORKSPACE_ID) {
    return {
      app: app
        .use(InstanceMiddleware(Flag.OPENCODE_WORKSPACE_ID ? WorkspaceID.make(Flag.OPENCODE_WORKSPACE_ID) : undefined))
        .use(FenceMiddleware)
        .route("/", InstanceRoutes()),
      runtime,
    }
  }

  const workspaceApp = new Hono()
  const workspaceLegacyApp = new Hono()
    .use(InstanceMiddleware())
    .route("/experimental/workspace", WorkspaceRoutes())
    .use(WorkspaceRouterMiddleware(runtime.upgradeWebSocket))
  const handler = ExperimentalHttpApiServer.webHandler().handler
  const context = Context.empty() as Context.Context<unknown>
  workspaceApp.get(WorkspacePaths.adaptors, (c) => handler(c.req.raw, context))
  workspaceApp.get(WorkspacePaths.list, (c) => handler(c.req.raw, context))
  workspaceApp.post(WorkspacePaths.list, (c) => handler(c.req.raw, context))
  workspaceApp.get(WorkspacePaths.status, (c) => handler(c.req.raw, context))
  workspaceApp.delete(WorkspacePaths.remove, (c) => handler(c.req.raw, context))
  workspaceApp.post(WorkspacePaths.sessionRestore, (c) => handler(c.req.raw, context))
  workspaceApp.route("/", workspaceLegacyApp)

  return {
    app: app
      .route("/", ControlPlaneRoutes())
      .route("/", workspaceApp)
      .route("/", InstanceRoutes())
      .route("/", UIRoutes()),
    runtime,
  }
}

export async function openapi() {
  // Build a fresh app with all routes registered directly so
  // hono-openapi can see describeRoute metadata (`.route()` wraps
  // handlers when the sub-app has a custom errorHandler, which
  // strips the metadata symbol).
  const { app } = create({})
  const result = await generateSpecs(app, {
    documentation: {
      info: {
        title: "opencode",
        version: "1.0.0",
        description: "opencode api",
      },
      openapi: "3.1.1",
    },
  })
  // Routes bridged into the Effect HttpApi (`handler(c.req.raw, context)` mounts) carry no describeRoute
  // metadata, so hono-openapi cannot see them and `opencode generate` drops them from the SDK. Their
  // contracts live in PublicApi: fill every method the Hono document lacks from it. On a component-name
  // collision the Hono definition wins — it is what the generated SDK already types, and the Effect dialect
  // differs (e.g. finite numbers also admit "NaN"/"Infinity" strings).
  const { PublicApi } = await import("./routes/instance/httpapi/public")
  const effect = OpenApi.fromApi(PublicApi)
  return {
    ...result,
    paths: Object.fromEntries(
      [...new Set([...Object.keys(result.paths), ...Object.keys(effect.paths)])].map((path) => [
        path,
        { ...effect.paths[path], ...result.paths[path] },
      ]),
    ) as typeof result.paths,
    components: {
      ...result.components,
      schemas: { ...effect.components.schemas, ...result.components?.schemas },
      securitySchemes: { ...effect.components.securitySchemes, ...result.components?.securitySchemes },
    } as typeof result.components,
  }
}

export let url: URL

export async function listen(opts: {
  port: number
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}): Promise<Listener> {
  const built = create(opts)
  const server = await built.runtime.listen(opts)

  const next = new URL("http://localhost")
  next.hostname = opts.hostname
  next.port = String(server.port)
  url = next

  const mdns =
    opts.mdns &&
    server.port &&
    opts.hostname !== "127.0.0.1" &&
    opts.hostname !== "localhost" &&
    opts.hostname !== "::1"
  if (mdns) {
    MDNS.publish(server.port, opts.mdnsDomain)
  } else if (opts.mdns) {
    log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
  }

  let closing: Promise<void> | undefined
  return {
    hostname: opts.hostname,
    port: server.port,
    url: next,
    stop(close?: boolean) {
      closing ??= (async () => {
        if (mdns) MDNS.unpublish()
        await server.stop(close)
      })()
      return closing
    },
  }
}

/**
 * t91/t92: the TUI worker's embedded host server (robot delegation) lives in
 * the IANA-unassigned range 29170-29998 (study:
  * experiments/2026-10-18_port-2727/RESULT.md). Base 29200; if it is taken,
  * the next free port INSIDE the range only — the earlier candidate was
  * dropped as IANA-registered (see the study). Never leaves the range.
 * `Server.listen` and both adapters are untouched: serve/web keep preferring
 * 4096 for port 0. Clients must read the real port from the worktree host
 * record (`server_host`), never assume it.
 */
export const TUI_HOST_PORT_MIN = 29170
export const TUI_HOST_PORT_BASE = 29200
export const TUI_HOST_PORT_MAX = 29998

/**
 * Ports this project never binds, probes or claims as its own: OAuth login
 * callbacks (transit, loopback-only), infra, web/debug. Source:
 * plans/2026-10-18_codex-oauth-empty-error.md port map. The delegation scan
 * range above contains none of them (pinned by test), and no probe in this
 * file names any of them.
 */
export const NEVER_BIND_PORTS: readonly number[] = [
  1455, 1456, 54545, 56121, 3005, 3010, 8079, 9222, 5432, 4096,
]

export async function listenTuiHost(opts: {
  hostname: string
  mdns?: boolean
  mdnsDomain?: string
  cors?: string[]
}): Promise<Listener> {
  const candidates: number[] = []
  for (let port = TUI_HOST_PORT_BASE; port <= TUI_HOST_PORT_MAX; port++) candidates.push(port)
  for (let port = TUI_HOST_PORT_MIN; port < TUI_HOST_PORT_BASE; port++) candidates.push(port)
  for (const port of candidates) {
    try {
      return await listen({ port, ...opts })
    } catch (error) {
      log.debug("tui host port taken, trying next", { port, error: String(error) })
    }
  }
  throw new Error(
    `TUI host found no free port in ${TUI_HOST_PORT_MIN}..${TUI_HOST_PORT_MAX} (base ${TUI_HOST_PORT_BASE})`,
  )
}

export * as Server from "./server"
