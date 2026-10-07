import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { storeApiKey } from "../../src/cli/cmd/providers"
import { AppRuntime } from "../../src/effect/app-runtime"
import { Auth } from "../../src/auth"

// Requirement (owner, 2026-10-07: «ключи в зашифрованное хранилище это мысль! Только проверь чтобы все работало»;
// plan robot-installer B4): the installer hands a user's key to the ROBOT, which stays the one writer of its store —
// no prompt, no network, the key only in auth.json.enc under the robot's own per-install key, never in plaintext.

let dir: string
let previous: string | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "key-stdin-"))
  previous = process.env.OPENCODE_TEST_CONFIG
  process.env.OPENCODE_TEST_CONFIG = dir // Global.Path.config — where auth.json lives, beside the exe in production
})

afterEach(async () => {
  if (previous === undefined) delete process.env.OPENCODE_TEST_CONFIG
  else process.env.OPENCODE_TEST_CONFIG = previous
  await fs.rm(dir, { recursive: true, force: true })
})

const exists = (p: string) => fs.stat(p).then(() => true).catch(() => false)
const stored = (provider: string) => AppRuntime.runPromise(Auth.Service.use((auth) => auth.get(provider)))
const fakeKey = "sk-or-v1-FAKEFAKEFAKE0123456789"

describe("providers login --key-stdin (installer path)", () => {
  test("stores the key encrypted-only, under a key the robot made, readable back", async () => {
    expect(await storeApiKey("openrouter", fakeKey)).toBeUndefined()
    expect(await exists(path.join(dir, "auth.json"))).toBeFalse()
    expect(await exists(path.join(dir, "auth.json.enc"))).toBeTrue()
    expect(await exists(path.join(dir, ".opencode.encryption.key"))).toBeTrue()
    expect(await fs.readFile(path.join(dir, "auth.json.enc"), "utf8")).not.toContain(fakeKey)
    const info = await stored("openrouter")
    expect(info?.type).toBe("api")
    if (info?.type === "api") expect(info.key).toBe(fakeKey)
  })

  test("a key piped through stdin loses its trailing newline", async () => {
    expect(await storeApiKey("openrouter", fakeKey + "\r\n")).toBeUndefined()
    const info = await stored("openrouter")
    if (info?.type !== "api") throw new Error("not stored")
    expect(info.key).toBe(fakeKey)
  })

  test("an unknown provider is refused and nothing is written", async () => {
    const err = await storeApiKey("no-such-provider", fakeKey)
    expect(err).toContain("no-such-provider")
    expect(await exists(path.join(dir, "auth.json.enc"))).toBeFalse()
  })

  test("an empty key is refused and nothing is written", async () => {
    expect(await storeApiKey("openrouter", "  \n")).toBeDefined()
    expect(await exists(path.join(dir, "auth.json.enc"))).toBeFalse()
  })
})
