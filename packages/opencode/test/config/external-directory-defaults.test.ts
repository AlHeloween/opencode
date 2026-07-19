/**
 * Tests for external_directory permission defaults.
 *
 * Verifies that system directories are allowed by default and
 * users can override via opencode.json → permission.external_directory.
 */
import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Config } from "@/config/config"
import { ConfigManaged } from "@/config/managed"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Instance } from "../../src/project/instance"
import { Auth } from "../../src/auth"
import { Account } from "../../src/account/account"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Env } from "../../src/env"
import { tmpdir } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Npm } from "@opencode-ai/core/npm"
import path from "path"
import fs from "fs/promises"

const infra = CrossSpawnSpawner.defaultLayer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
)

const emptyAccount = Layer.mock(Account.Service)({
  active: () => Effect.succeed(Option.none()),
  activeOrg: () => Effect.succeed(Option.none()),
})

const emptyAuth = Layer.mock(Auth.Service)({
  all: () => Effect.succeed({}),
})

const layer = Config.layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(emptyAuth),
  Layer.provide(emptyAccount),
  Layer.provideMerge(infra),
  Layer.provide(Npm.defaultLayer),
)

const load = () =>
  Effect.runPromise(Config.Service.use((svc) => svc.get()).pipe(Effect.scoped, Effect.provide(layer)))

const managedConfigDir = process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR!

beforeEach(async () => {
  await Effect.runPromise(
    Config.Service.use((svc) => svc.invalidate(true)).pipe(
      Effect.scoped,
      Effect.provide(layer),
    ),
  )
})

afterEach(async () => {
  await fs.rm(managedConfigDir, { force: true, recursive: true }).catch(() => {})
  await Effect.runPromise(
    Config.Service.use((svc) => svc.invalidate(true)).pipe(
      Effect.scoped,
      Effect.provide(layer),
    ),
  )
})

describe("config external_directory defaults", () => {
  test("system directories are allowed by default", async () => {
    await using tmp = await tmpdir({ config: {} })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        const ext = config.permission?.external_directory
        expect(ext).toBeDefined()
        if (!ext || typeof ext === "string") return // skip if mode-only

        if (process.platform === "win32") {
          expect(ext["C:\\Windows\\*"]).toBe("allow")
          expect(ext["C:\\Program Files\\*"]).toBe("allow")
          expect(ext["C:\\Program Files (x86)\\*"]).toBe("allow")
        }
        expect(ext["/usr/*"]).toBe("allow")
        expect(ext["/bin/*"]).toBe("allow")
        expect(ext["/etc/*"]).toBe("allow")
      },
    })
  })

  test("user can override system defaults via config", async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          external_directory: {
            "C:\\Windows\\*": "deny",
            "/usr/*": "ask",
          },
        },
      } as any,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        const ext = config.permission?.external_directory
        expect(ext).toBeDefined()
        if (!ext || typeof ext === "string") return

        if (process.platform === "win32") {
          // User override takes precedence over system default
          expect(ext["C:\\Windows\\*"]).toBe("deny")
        }
        expect(ext["/usr/*"]).toBe("ask")
        // When user provides explicit external_directory rules,
        // system defaults are NOT merged — user has full control
      },
    })
  })

  test("user can add custom paths via config", async () => {
    await using tmp = await tmpdir({
      config: {
        permission: {
          external_directory: {
            "C:\\Users\\*\\AppData\\Local\\Microsoft\\WindowsApps\\*": "allow",
          },
        },
      } as any,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        const ext = config.permission?.external_directory
        expect(ext).toBeDefined()
        if (!ext || typeof ext === "string") return

        // Custom path is present
        expect(
          ext["C:\\Users\\*\\AppData\\Local\\Microsoft\\WindowsApps\\*"],
        ).toBe("allow")
        // When user provides explicit external_directory, system defaults
        // are not merged — user has full control over the rules
      },
    })
  })

  test("navigation.allow overrides system defaults", async () => {
    await using tmp = await tmpdir({
      config: {
        navigation: {
          allow: ["C:\\CustomTool"],
          deny: ["C:\\Windows"],
        },
      } as any,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        const ext = config.permission?.external_directory
        expect(ext).toBeDefined()
        if (!ext || typeof ext === "string") return

        if (process.platform === "win32") {
          // navigation.deny overrides system allow default
          expect(ext[path.resolve("C:\\Windows") + "\\*"]).toBe("deny")
          // navigation.allow adds new paths
          expect(ext[path.resolve("C:\\CustomTool") + "\\*"]).toBe("allow")
        }
        // System defaults for non-overridden paths
        expect(ext["/bin/*"]).toBe("allow")
      },
    })
  })

  test("external_directory_mode: deny blocks everything except navigation.allow", async () => {
    await using tmp = await tmpdir({
      config: {
        external_directory_mode: "deny",
        navigation: {
          allow: ["/opt/myapp"],
        },
      } as any,
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await load()
        const ext = config.permission?.external_directory
        expect(ext).toBeDefined()
        if (!ext || typeof ext === "string") return

        // "*": "deny" from external_directory_mode
        expect(ext["*"]).toBe("deny")
        // navigation.allow path still works
        if (process.platform !== "win32") {
          expect(ext[path.resolve("/opt/myapp") + "/*"]).toBe("allow")
        }
      },
    })
  })
})
