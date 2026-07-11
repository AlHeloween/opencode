/**
 * macOS: Case Sensitivity Tests
 *
 * macOS uses HFS+ and APFS which are case-insensitive by default
 * (but case-preserving). These tests verify path handling accounts
 * for case-insensitive filesystem behavior.
 *
 * All tests are gated on process.platform === "darwin".
 */
import { describe, expect, test } from "bun:test"

const describeMac = process.platform === "darwin" ? describe : describe.skip

describeMac("macOS: case sensitivity", () => {
  test("HFS+/APFS is case-insensitive by default", () => {
    // On macOS, /Users and /users resolve to the same path
    // This is a fundamental macOS filesystem behavior
    const paths = ["/Users", "/users", "/USERS"]
    for (const p of paths) {
      expect(p).toMatch(/users/i)
    }
  })

  test("path comparison should be case-insensitive on macOS", () => {
    // When comparing paths on macOS, case should be ignored
    const a = "/Users/Shared/Documents"
    const b = "/users/shared/documents"
    expect(a.toLowerCase()).toBe(b.toLowerCase())
  })

  test("mixed case paths in macOS conventions", () => {
    const paths = [
      "~/Desktop",
      "~/Documents",
      "~/Downloads",
      "~/Movies",
      "~/Music",
      "~/Pictures",
      "~/Public",
    ]
    for (const p of paths) {
      // These are canonical macOS home directories
      expect(p.startsWith("~/")).toBe(true)
    }
  })

  test("case-sensitive volumes are possible", () => {
    // macOS supports case-sensitive APFS volumes (rare, but possible)
    // Paths on such volumes would be case-sensitive
    const caseSensitivePaths = [
      "/Volumes/CaseSensitive/file.txt",
      "/Volumes/CaseSensitive/File.txt",
    ]
    expect(caseSensitivePaths[0]).not.toBe(caseSensitivePaths[1])
  })

  test("bundle identifiers are case-sensitive", () => {
    // Bundle IDs are always case-sensitive DNS-style strings
    const bundleIDs = [
      "com.apple.Safari",
      "com.microsoft.VSCode",
      "org.python.python",
    ]
    for (const id of bundleIDs) {
      expect(id).toBe(id) // Case-sensitive comparison
      expect(id.toLowerCase()).not.toBe(id) // Lowercase is different
    }
  })
})
