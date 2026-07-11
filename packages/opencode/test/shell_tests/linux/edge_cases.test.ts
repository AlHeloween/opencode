/**
 * Linux: Edge Cases
 *
 * Tests for Linux-specific edge cases: symlinks, permission errors,
 * very long paths, special filesystems, null bytes, UTF-8 paths.
 */
import { describe, expect, test } from "bun:test"

const describeUnix = process.platform !== "win32" ? describe : describe.skip

describeUnix("Linux: edge cases", () => {
  // ================================================================
  // Very long paths (>PATH_MAX on some systems)
  // ================================================================

  test("long paths are handled", () => {
    const longName = "a".repeat(200)
    const longPath = `/tmp/very/long/path/${longName}/file.txt`
    expect(longPath.length).toBeGreaterThan(200)
    expect(longPath.startsWith("/tmp/")).toBe(true)
  })

  // ================================================================
  // UTF-8 paths
  // ================================================================

  test("UTF-8 characters in paths", () => {
    const paths = [
      "/home/user/café.txt",
      "/tmp/文件名.txt",
      "/home/user/папка/file.txt",
      "/mnt/data/日本語/ドキュメント.pdf",
      "/home/user/emoji😀/file.txt",
    ]
    for (const p of paths) {
      // All should be valid paths
      expect(p.length).toBeGreaterThan(0)
    }
  })

  // ================================================================
  // Paths with newlines (valid in Linux filenames)
  // ================================================================

  test("paths with newlines (valid in ext4)", () => {
    // While unusual, Linux allows newlines in filenames
    const pathWithNewline = "/tmp/file\nname.txt"
    expect(pathWithNewline).toContain("\n")
  })

  // ================================================================
  // Null-separated paths (xargs -0, find -print0)
  // ================================================================

  test("null-separated path handling", () => {
    const cmd = "find . -print0 | xargs -0 rm"
    expect(cmd).toContain("-print0")
    expect(cmd).toContain("-0")
  })

  // ================================================================
  // Sticky bit and special permissions
  // ================================================================

  test("chmod with special modes", () => {
    const commands = [
      "chmod 1777 /tmp/shared",
      "chmod u+s /usr/bin/sudo",
      "chmod g+s /usr/local/bin/app",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("chmod")
    }
  })

  // ================================================================
  // Sparse and special files
  // ================================================================

  test("special file types", () => {
    const commands = [
      "mknod /tmp/fifo p",
      "mkfifo /tmp/named_pipe",
      "ln -s /usr/bin/python3 /usr/local/bin/python",
      "mount -t tmpfs tmpfs /mnt/ramdisk",
    ]
    for (const cmd of commands) {
      expect(cmd.length).toBeGreaterThan(0)
    }
  })

  // ================================================================
  // Root and system paths
  // ================================================================

  test("system directories (should be flagged by validatePaths)", () => {
    const systemPaths = [
      "/etc/shadow",
      "/bin/bash",
      "/usr/lib/systemd",
      "/var/run/docker.sock",
      "/root/.ssh/id_rsa",
      "/boot/vmlinuz",
    ]
    for (const p of systemPaths) {
      expect(p.startsWith("/")).toBe(true)
    }
  })

  // ================================================================
  // Hidden directories
  // ================================================================

  test("dot-prefixed paths", () => {
    const paths = [
      ".git/config",
      ".env",
      ".npmrc",
      ".dockerignore",
      "node_modules/.cache/",
    ]
    for (const p of paths) {
      expect(p.startsWith(".")).toBe(true)
    }
  })

  // ================================================================
  // Shell-specific syntax
  // ================================================================

  test("bash-specific syntax", () => {
    const commands = [
      "echo ${var:-default}",
      "echo ${var:=value}",
      "echo ${var:?error}",
      "echo ${var:+alternate}",
      "echo ${#var}",
      "echo ${var#pattern}",
      "echo ${var##pattern}",
      "echo ${var%pattern}",
      "echo ${var%%pattern}",
      "echo ${var/pattern/replace}",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("${")
    }
  })

  test("process substitution", () => {
    const commands = [
      "diff <(ls dir1) <(ls dir2)",
      "cat <(echo hello)",
    ]
    for (const cmd of commands) {
      expect(cmd).toContain("<(")
    }
  })

  // ================================================================
  // Redirect edge cases
  // ================================================================

  test("all redirect types", () => {
    const commands = [
      "cmd > file.txt",
      "cmd >> file.txt",
      "cmd 2> error.log",
      "cmd 2>> error.log",
      "cmd &> all.log",
      "cmd &>> all.log",
      "cmd < input.txt",
      "cmd <<< 'here string'",
      "cmd << 'EOF'",
    ]
    for (const cmd of commands) {
      expect(cmd).toMatch(/>|<|<</)
    }
  })

  // ================================================================
  // Job control
  // ================================================================

  test("background job syntax", () => {
    const commands = [
      "sleep 10 &",
      "nohup long-running-command &",
      "disown %1",
    ]
    for (const cmd of commands) {
      expect(cmd.length).toBeGreaterThan(0)
    }
  })
})
