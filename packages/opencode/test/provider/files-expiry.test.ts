import { describe, expect, test } from "bun:test"
import { fileIsUsable } from "../../src/provider/files-api"

const NOW = 1_800_000_000_000

describe("file usability", () => {
  test("an unverified file is never usable, however fresh", () => {
    // The provider exposes no state to poll, so "we asked and it answered" is
    // the only evidence a file exists. Sending an unverified id on faith fails
    // later and further from its cause.
    expect(fileIsUsable({ fileId: "file-api-x", expiresAt: NOW + 1000, verifiedAt: null }, NOW)).toBe(false)
  })

  test("a verified file inside its term is usable", () => {
    expect(fileIsUsable({ fileId: "file-api-x", expiresAt: NOW + 1000, verifiedAt: NOW - 1 }, NOW)).toBe(true)
  })

  test("a file at the instant of expiry is already dead", () => {
    expect(fileIsUsable({ fileId: "file-api-x", expiresAt: NOW, verifiedAt: NOW - 1 }, NOW)).toBe(false)
  })

  test("a file past its term is refused even though it verified a moment ago", () => {
    expect(fileIsUsable({ fileId: "file-api-x", expiresAt: NOW - 1, verifiedAt: NOW - 1 }, NOW)).toBe(false)
  })

  test("no term means permanent — the API's meaning, not an oversight", () => {
    // A null expiry that read as expired would refuse every permanent file, and
    // the owner of a permanent file has no way to renew it.
    expect(fileIsUsable({ fileId: "file-api-x", expiresAt: null, verifiedAt: NOW - 1 }, NOW + 10_000_000)).toBe(true)
  })
})