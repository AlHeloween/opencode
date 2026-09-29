import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { sealUserText } from "../../src/session/user-seal"

/**
 * Owner directive 2026-09-29: «вместе с сообщением пользователя будем отправлять хеш
 * от сообщения с временем… устойчивый демпфер корреляций». The seal appends
 * `time: <ISO>` + `md5: <32hex>` to the message text; determinism is load-bearing
 * for the provider KV cache (message time, never wall-clock).
 */
describe("user message seal", () => {
  const t = Date.UTC(2026, 8, 29, 8, 47, 17, 394)

  test("appends time and a 32-hex md5 of text·time", () => {
    const sealed = sealUserText("hello", t)
    expect(sealed.startsWith("hello\n")).toBe(true)
    expect(sealed).toContain("time: 2026-09-29T08:47:17.394Z")
    expect(sealed).toMatch(/md5: [0-9a-f]{32}$/)
  })

  test("deterministic for the same inputs (KV prefix stability)", () => {
    expect(sealUserText("hello", t)).toBe(sealUserText("hello", t))
  })

  test("both inputs move the digest", () => {
    expect(sealUserText("hello", t)).not.toBe(sealUserText("hello!", t))
    expect(sealUserText("hello", t)).not.toBe(sealUserText("hello", t + 1))
  })
})

describe("the converter seals the LAST text part of every user message", () => {
  const SOURCE = fs
    .readFileSync(path.join(import.meta.dir, "../../src/session/message-v2.ts"), "utf8")
    .replace(/\r\n/g, "\n")

  test("the user branch calls sealUserText with the message time", () => {
    const from = SOURCE.indexOf('if (msg.info.role === "user")')
    const to = SOURCE.indexOf('if (msg.info.role === "assistant")')
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const userBranch = SOURCE.slice(from, to)
    expect(userBranch).toContain("sealUserText(part.text, msg.info.time.created)")
    expect(userBranch).toContain("sealTarget")
  })
})
