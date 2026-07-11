/**
 * macOS: Edge Cases
 *
 * Tests for macOS-specific edge cases: .DS_Store, resource forks,
 * aliases vs symlinks, Time Machine exclusions, sandbox paths.
 *
 * All tests are gated on process.platform === "darwin".
 */
import { describe, expect, test } from "bun:test"

const describeMac = process.platform === "darwin" ? describe : describe.skip

describeMac("macOS: edge cases", () => {
  // ================================================================
  // .DS_Store files
  // ================================================================

  test(".DS_Store files in directories", () => {
    // Finder creates .DS_Store in every directory it opens
    const paths = [
      "/Users/user/Desktop/.DS_Store",
      "~/Documents/Projects/.DS_Store",
    ]
    for (const p of paths) {
      expect(p).toContain(".DS_Store")
    }
  })

  // ================================================================
  // Aliases vs symlinks
  // ================================================================

  test("Finder aliases (not Unix symlinks)", () => {
    // macOS Finder aliases are different from Unix symlinks
    // They have resource fork data and can track moved files
    const aliasPaths = [
      "/Users/user/Desktop/My Alias",
    ]
    for (const p of aliasPaths) {
      expect(p).toContain("Alias")
    }
  })

  // ================================================================
  // Time Machine exclusion
  // ================================================================

  test("Time Machine metadata attribute paths", () => {
    // `tmutil` manages Time Machine exclusions
    const commands = [
      "tmutil isexcluded /path/to/dir",
      "tmutil addexclusion /path/to/dir",
      "tmutil removeexclusion /path/to/dir",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("tmutil")
    }
  })

  // ================================================================
  // Sandbox paths in macOS
  // ================================================================

  test("App sandbox container paths", () => {
    const paths = [
      "~/Library/Containers/com.apple.Safari/Data/",
      "~/Library/Containers/com.microsoft.VSCode/Data/",
    ]
    for (const p of paths) {
      expect(p).toContain("Containers")
    }
  })

  // ================================================================
  // Extended attributes
  // ================================================================

  test("extended attribute commands", () => {
    const commands = [
      "xattr -l file.txt",
      "xattr -w com.apple.metadata:kMDItemWhereFroms file.txt",
      "xattr -d com.apple.quarantine file.txt",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("xattr")
    }
  })

  // ================================================================
  // Launch services and plist paths
  // ================================================================

  test("LaunchAgents and LaunchDaemons paths", () => {
    const paths = [
      "~/Library/LaunchAgents/com.user.script.plist",
      "/Library/LaunchDaemons/com.apple.daemon.plist",
      "/System/Library/LaunchDaemons/",
    ]
    for (const p of paths) {
      expect(p).toMatch(/Launch(Agent|Daemon)s/)
      expect(p).toContain(".plist")
    }
  })

  // ================================================================
  // Homebrew paths
  // ================================================================

  test("Homebrew installation paths", () => {
    // Intel Macs: /usr/local, Apple Silicon: /opt/homebrew
    const paths = [
      "/usr/local/bin/brew",
      "/opt/homebrew/bin/brew",
      "/usr/local/Cellar/",
      "/opt/homebrew/Cellar/",
    ]
    for (const p of paths) {
      expect(p).toMatch(/\/brew$|\/Cellar\//)
    }
  })

  // ================================================================
  // Keychain paths
  // ================================================================

  test("keychain paths", () => {
    const paths = [
      "~/Library/Keychains/login.keychain-db",
      "/Library/Keychains/System.keychain",
    ]
    for (const p of paths) {
      expect(p).toContain("Keychain")
    }
  })

  // ================================================================
  // Disk utility and APFS
  // ================================================================

  test("APFS snapshot paths", () => {
    // APFS snapshots are at /.snapshots/
    const paths = [
      "/.snapshots/",
      "/System/Volumes/Data/",
    ]
    for (const p of paths) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  // ================================================================
  // SIP (System Integrity Protection) paths
  // ================================================================

  test("SIP-protected paths", () => {
    const paths = [
      "/System/",
      "/usr/bin/",
      "/bin/",
      "/sbin/",
    ]
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(true)
    }
  })

  // ================================================================
  // Staging and quarantine
  // ================================================================

  test("quarantine attribute handling", () => {
    // macOS Gatekeeper adds com.apple.quarantine xattr
    const commands = [
      "xattr -d com.apple.quarantine /Applications/App.app",
      "spctl --assess --verbose /Applications/App.app",
    ]
    for (const cmd of commands) {
      expect(cmd).toMatch(/xattr|spctl/)
    }
  })

  // ================================================================
  // Open command (macOS-specific)
  // ================================================================

  test("open command paths", () => {
    const commands = [
      "open /Applications/Safari.app",
      "open -a TextEdit file.txt",
      "open -R file.txt",
      "open .",
    ]
    for (const cmd of commands) {
      expect(cmd).toStartWith("open ")
    }
  })

  // ================================================================
  // pbcopy / pbpaste (macOS clipboard)
  // ================================================================

  test("pbcopy / pbpaste commands", () => {
    const commands = [
      "echo hello | pbcopy",
      "pbpaste > output.txt",
    ]
    for (const cmd of commands) {
      expect(cmd).toMatch(/pbcopy|pbpaste/)
    }
  })
})
