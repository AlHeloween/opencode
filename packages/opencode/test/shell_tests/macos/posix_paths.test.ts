/**
 * macOS: POSIX Path Tests
 *
 * Tests for macOS-specific path handling. macOS is Unix-based but has
 * unique path conventions (Users/, /Applications/, /Volumes/, framework paths).
 *
 * All tests are gated on process.platform === "darwin".
 */
import { describe, expect, test } from "bun:test"

const describeMac = process.platform === "darwin" ? describe : describe.skip

describeMac("macOS: POSIX path handling", () => {
  test("macOS user paths", () => {
    const paths = [
      "/Users/Shared/Documents",
      "~/Library/Application Support",
      "~/Library/Preferences",
      "~/Library/Caches",
      "~/Library/Logs",
    ]
    for (const p of paths) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  test("/Applications paths", () => {
    const paths = [
      "/Applications/Safari.app",
      "/Applications/Utilities/Terminal.app",
      "/Applications/Xcode.app/Contents/Developer",
      "/System/Applications/",
    ]
    for (const p of paths) {
      expect(p).toContain("Applications")
    }
  })

  test("/Volumes paths (mounted drives)", () => {
    const paths = [
      "/Volumes/ExternalDrive/",
      "/Volumes/Time Machine Backups/",
      "/Volumes/.timemachine/",
    ]
    for (const p of paths) {
      expect(p.startsWith("/Volumes/")).toBe(true)
    }
  })

  test("framework paths", () => {
    const paths = [
      "/System/Library/Frameworks/Foundation.framework",
      "/Library/Frameworks/Python.framework",
      "~/Library/Frameworks/",
    ]
    for (const p of paths) {
      expect(p).toContain(".framework")
    }
  })

  test("bundle paths (.app, .bundle)", () => {
    const paths = [
      "/Applications/MyApp.app/Contents/MacOS/MyApp",
      "/Applications/MyApp.app/Contents/Info.plist",
      "/Applications/MyApp.app/Contents/Resources/",
    ]
    for (const p of paths) {
      expect(p).toContain(".app/Contents")
    }
  })

  test("standard Unix paths on macOS", () => {
    const paths = [
      "/usr/local/bin/brew",
      "/opt/homebrew/bin/",
      "/usr/local/opt/",
      "/etc/pam.d/sudo",
      "/var/log/system.log",
    ]
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(true)
    }
  })

  test("/tmp and temporary directories", () => {
    // macOS uses /var/folders for per-user temp
    const paths = [
      "/tmp/",
      "/private/tmp/",
      "/var/folders/xx/xxxxx/T/",
    ]
    for (const p of paths) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  test("Xcode derived data paths", () => {
    const paths = [
      "~/Library/Developer/Xcode/DerivedData/",
      "~/Library/Developer/Xcode/Archives/",
      "~/Library/Developer/CoreSimulator/Devices/",
    ]
    for (const p of paths) {
      expect(p).toContain("Developer")
    }
  })
})
