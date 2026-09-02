import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { Auth } from "../../src/auth"

// Raw-start regression (2026-09-02, Alexander): a hand-seeded plaintext
// auth.json (exe-dir config; the .enc mirror only appears after a
// successful parse) with invalid JSON must not kill the CLI, and must not
// mirror an empty payload into the encrypted store — otherwise deleting
// the plaintext file later would silently erase auth.

describe("auth raw-start", () => {
  let tmp: string
  let prevConfig: string | undefined
  let prevAuthContent: string | undefined

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auth-raw-start-"))
    prevConfig = process.env.OPENCODE_TEST_CONFIG
    prevAuthContent = process.env.OPENCODE_AUTH_CONTENT
    // authFile() = {Global.Path.config}/auth.json; the env hook redirects it.
    process.env.OPENCODE_TEST_CONFIG = tmp
    delete process.env.OPENCODE_AUTH_CONTENT
  })

  afterAll(() => {
    if (prevConfig === undefined) delete process.env.OPENCODE_TEST_CONFIG
    else process.env.OPENCODE_TEST_CONFIG = prevConfig
    if (prevAuthContent !== undefined) process.env.OPENCODE_AUTH_CONTENT = prevAuthContent
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  const all = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        return yield* auth.all()
      }).pipe(Effect.provide(Auth.defaultLayer)),
    )

  test("invalid plaintext auth.json → empty auth, no crash, no mirror poisoning", async () => {
    // Unquoted property name — the exact "Property name must be a string
    // literal" content class from the crash report.
    fs.writeFileSync(path.join(tmp, "auth.json"), `{ openrouter: { type: "api", key: "sk-x" } }`)
    const result = await all()
    expect(result).toEqual({})
    expect(fs.existsSync(path.join(tmp, "auth.json.enc"))).toBe(false)
  })

  test("valid plaintext auth.json → parsed auth + encrypted mirror", async () => {
    fs.writeFileSync(
      path.join(tmp, "auth.json"),
      JSON.stringify({ openrouter: { type: "api", key: "sk-test" } }, null, 2),
    )
    const result = await all()
    expect(result).toEqual({ openrouter: { type: "api", key: "sk-test" } })
    expect(fs.existsSync(path.join(tmp, "auth.json.enc"))).toBe(true)
  })
})
