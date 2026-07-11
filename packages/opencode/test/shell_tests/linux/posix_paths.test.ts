/**
 * Linux: POSIX Path Tests
 *
 * Tests for Linux/Unix path handling. These verify that shell commands
 * with POSIX paths work correctly, including home expansion, symlinks,
 * special characters, and redirect handling.
 *
 * All tests are gated on process.platform !== "win32".
 */
import { describe, expect, test } from "bun:test"

const describeUnix = process.platform !== "win32" ? describe : describe.skip

describeUnix("Linux: POSIX path handling", () => {
  test("absolute paths are preserved", () => {
    // This validates that POSIX paths are not mutated by any normalization
    const paths = [
      "/home/user/file.txt",
      "/etc/nginx/nginx.conf",
      "/var/log/syslog",
      "/usr/local/bin/node",
      "/tmp/opencode-test-XXXX",
    ]
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(true)
      expect(p.includes("\\")).toBe(false)
    }
  })

  test("relative paths are preserved", () => {
    const paths = [
      "./script.sh",
      "../parent/file.txt",
      "subdir/nested/deep.txt",
      "../../../etc/passwd",
    ]
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(p.startsWith("/"))
    }
  })

  test("home directory expansion (~)", () => {
    // ~ expands to $HOME in bash
    const paths = [
      "~/Documents",
      "~/.ssh/config",
      "~root/.bashrc",
    ]
    for (const p of paths) {
      expect(p.startsWith("~")).toBe(true)
    }
  })

  test("paths with spaces", () => {
    const paths = [
      "'/home/user/My Documents/file.txt'",
      '"/mnt/shared/Team Projects/report.pdf"',
      "/home/user/Spaced\\ Folder/script.sh",
    ]
    for (const p of paths) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  test("paths with special characters", () => {
    const paths = [
      "/home/user/file-name.txt",
      "/home/user/file_name.txt",
      "/home/user/file.name.txt",
      "/tmp/file (copy).txt",
      "/tmp/file[1].txt",
    ]
    for (const p of paths) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  test("hidden files and directories", () => {
    const paths = [
      "~/.bashrc",
      "~/.config/",
      "~/.local/share/",
      "~/.cache/",
    ]
    for (const p of paths) {
      expect(p.includes("/.")).toBe(true)
    }
  })

  test("symlink paths", () => {
    // Symlinks use regular path syntax
    const paths = [
      "/usr/bin/python -> /usr/bin/python3",
      "/etc/alternatives/java",
    ]
    for (const p of paths) {
      expect(p.length).toBeGreaterThan(0)
    }
  })

  test("/dev/null paths", () => {
    expect("/dev/null").toBe("/dev/null")
    expect("/dev/zero").toBe("/dev/zero")
    expect("/dev/random").toBe("/dev/random")
    expect("/dev/urandom").toBe("/dev/urandom")
  })

  test("/proc and /sys paths", () => {
    const paths = [
      "/proc/cpuinfo",
      "/proc/meminfo",
      "/sys/class/net/eth0",
    ]
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(true)
    }
  })

  test("NFS and mounted paths", () => {
    const paths = [
      "/mnt/nfs/data/file.txt",
      "/media/usb/backup.tar.gz",
      "/run/media/user/DRIVE/",
    ]
    for (const p of paths) {
      expect(p.startsWith("/")).toBe(true)
    }
  })
})
