/**
 * Production failure smoke: a configured local CodeGraph command that cannot
 * spawn must make mcpTouchThenSqlitePack() fail. No raw MCP SDK or CodeGraph CLI.
 *
 * Usage (from packages/opencode):
 *   bun test/codegraph/mcp_configured_down_smoke.ts
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Effect, Exit, Layer } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { MCP } from "../../src/mcp"
import { McpAuth } from "../../src/mcp/auth"
import { mcpTouchThenSqlitePack } from "../../src/codegraph/mcp-client"
import { provideInstance } from "../fixture/fixture"

const ROOT = process.env.OPENCODE_ROOT
  ? path.resolve(process.env.OPENCODE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

async function main() {
  const config = Layer.succeed(
    Config.Service,
    Config.Service.of({
      get: () =>
        Effect.succeed({
          mcp: {
            codegraph: {
              type: "local",
              command: ["opencode-codegraph-intentionally-missing", "serve", "--mcp"],
              enabled: true,
              timeout: 1_000,
            },
          },
        } as Config.Info),
      getGlobal: () => Effect.succeed({} as Config.Info),
      getConsoleState: () =>
        Effect.succeed({ consoleManagedProviders: [], activeOrgName: undefined, switchableOrgCount: 0 }),
      update: () => Effect.void,
      updateGlobal: () => Effect.succeed({} as Config.Info),
      invalidate: () => Effect.void,
      directories: () => Effect.succeed([]),
      waitForDependencies: () => Effect.void,
    }),
  )
  const mcp = MCP.layer.pipe(
    Layer.provide(McpAuth.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(config),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
  )

  console.log("Calling production hybrid wrapper against missing configured local server")
  const exit = await Effect.runPromiseExit(
    mcpTouchThenSqlitePack(ROOT, ["packages/opencode/src/session/compaction.ts"], { debounceMs: 0 }).pipe(
      Effect.provide(mcp),
      provideInstance(ROOT),
    ),
  )

  if (Exit.isSuccess(exit)) fail("configured missing CodeGraph executable returned a structural pack")
  const detail = String(exit.cause)
  if (!/codegraph|mcp|connect|spawn|failed/i.test(detail)) fail(`failure was not explicit: ${detail}`)
  console.log(`MCP failure: ${detail.slice(0, 500)}`)
  console.log("PASS: configured missing MCP server hard-fails; no empty structural pack")
}

main().catch((error) => {
  if (error instanceof Error && error.stack) console.error(error.stack)
  fail(error instanceof Error ? error.message : String(error))
})
