import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import path from "path"
import { Auth } from "../../src/auth"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Auth.defaultLayer, node))

function withConfigDir<A, E, R>(dir: string, self: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_TEST_CONFIG
      process.env.OPENCODE_TEST_CONFIG = dir
      return previous
    }),
    () => self,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.OPENCODE_TEST_CONFIG
        else process.env.OPENCODE_TEST_CONFIG = previous
      }),
  )
}

async function exists(filepath: string) {
  return fs.stat(filepath).then(() => true).catch(() => false)
}

describe("Auth", () => {
  it.live("set normalizes trailing slashes in keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeDefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set cleans up pre-existing trailing-slash entry", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com/", {
          type: "wellknown",
          key: "TOKEN",
          token: "old",
        })
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "new",
        })
        const data = yield* auth.all()
        const keys = Object.keys(data).filter((key) => key.includes("example.com"))
        expect(keys).toEqual(["https://example.com"])
        const entry = data["https://example.com"]!
        expect(entry.type).toBe("wellknown")
        if (entry.type === "wellknown") expect(entry.token).toBe("new")
      }),
    ),
  )

  it.live("remove deletes both trailing-slash and normalized keys", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("https://example.com", {
          type: "wellknown",
          key: "TOKEN",
          token: "abc",
        })
        yield* auth.remove("https://example.com/")
        const data = yield* auth.all()
        expect(data["https://example.com"]).toBeUndefined()
        expect(data["https://example.com/"]).toBeUndefined()
      }),
    ),
  )

  it.live("set and remove are no-ops on keys without trailing slashes", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.set("anthropic", {
          type: "api",
          key: "sk-test",
        })
        const data = yield* auth.all()
        expect(data["anthropic"]).toBeDefined()
        yield* auth.remove("anthropic")
        const after = yield* auth.all()
        expect(after["anthropic"]).toBeUndefined()
      }),
    ),
  )

  it.live("uses encrypted auth storage when auth.json is absent", () =>
    provideTmpdirInstance((dir) =>
      withConfigDir(
        dir,
        Effect.gen(function* () {
          const auth = yield* Auth.Service
          const authPath = path.join(Global.Path.config, "auth.json")
          yield* auth.set("anthropic", {
            type: "api",
            key: "sk-encrypted-only",
          })

          expect(yield* Effect.promise(() => exists(authPath))).toBeFalse()
          expect(yield* Effect.promise(() => exists(`${authPath}.enc`))).toBeTrue()
          expect(yield* Effect.promise(() => fs.readFile(`${authPath}.enc`, "utf8"))).not.toContain("sk-encrypted-only")
          expect((yield* auth.all()).anthropic?.type).toBe("api")
        }),
      ),
    ),
  )

  it.live("mirrors plaintext auth to encrypted storage and falls back when plaintext is removed", () =>
    provideTmpdirInstance((dir) =>
      withConfigDir(
        dir,
        Effect.gen(function* () {
          const authPath = path.join(Global.Path.config, "auth.json")
          yield* Effect.promise(() =>
            fs.writeFile(
              authPath,
              JSON.stringify({ anthropic: { type: "api", key: "sk-plaintext-mirror" } }, null, 2),
            ),
          )

          const auth = yield* Auth.Service
          expect((yield* auth.all()).anthropic?.type).toBe("api")
          expect(yield* Effect.promise(() => exists(`${authPath}.enc`))).toBeTrue()
          expect(yield* Effect.promise(() => fs.readFile(`${authPath}.enc`, "utf8"))).not.toContain("sk-plaintext-mirror")

          yield* Effect.promise(() => fs.rm(authPath))
          const data = yield* auth.all()
          expect(data.anthropic?.type).toBe("api")
          if (data.anthropic?.type === "api") expect(data.anthropic.key).toBe("sk-plaintext-mirror")
        }),
      ),
    ),
  )
})
