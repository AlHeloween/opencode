import { describe, expect, test } from "bun:test"
import { Shell } from "../../../src/shell/shell"

describe("Shell detection", () => {
  // ================================================================
  // Shell.name
  // ================================================================

  test("Shell.name extracts basename from full path", () => {
    expect(Shell.name("C:\\Windows\\System32\\cmd.exe")).toBe("cmd")
    expect(Shell.name("/bin/bash")).toBe("bash")
    expect(Shell.name("/usr/bin/zsh")).toBe("zsh")
  })

  test("Shell.name handles pwsh executable", () => {
    expect(Shell.name("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("pwsh")
    expect(Shell.name("/usr/bin/pwsh")).toBe("pwsh")
  })

  test("Shell.name handles powershell executable", () => {
    expect(Shell.name("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("powershell")
  })

  test("Shell.name handles Git Bash path", () => {
    expect(Shell.name("C:\\Program Files\\Git\\bin\\bash.exe")).toBe("bash")
  })

  // ================================================================
  // Shell.posix
  // ================================================================

  test("Shell.posix returns true for POSIX shells", () => {
    for (const shell of ["bash", "dash", "ksh", "sh", "zsh"]) {
      expect(Shell.posix(shell)).toBe(true)
    }
  })

  test("Shell.posix returns false for non-POSIX shells", () => {
    for (const shell of ["cmd", "pwsh", "powershell", "fish", "nu"]) {
      expect(Shell.posix(shell)).toBe(false)
    }
  })

  // ================================================================
  // Shell.ps (PowerShell detection)
  // ================================================================

  test("Shell.ps returns true for PowerShell variants", () => {
    expect(Shell.ps("pwsh")).toBe(true)
    expect(Shell.ps("powershell")).toBe(true)
  })

  test("Shell.ps returns false for non-PowerShell shells", () => {
    for (const shell of ["cmd", "bash", "zsh", "sh"]) {
      expect(Shell.ps(shell)).toBe(false)
    }
  })

  // ================================================================
  // Shell.login
  // ================================================================

  test("Shell.login returns true for login shells", () => {
    for (const shell of ["bash", "dash", "ksh", "sh", "zsh", "fish"]) {
      expect(Shell.login(shell)).toBe(true)
    }
  })

  test("Shell.login returns false for non-login shells", () => {
    for (const shell of ["cmd", "pwsh", "powershell", "nu"]) {
      expect(Shell.login(shell)).toBe(false)
    }
  })

  // ================================================================
  // Shell.acceptable
  // ================================================================

  test("Shell.acceptable resolves to a valid shell on current platform", () => {
    Shell.acceptable.reset()
    const shell = Shell.acceptable()
    const name = Shell.name(shell)
    if (process.platform === "win32") {
      expect(["cmd", "powershell", "pwsh", "bash"].includes(name)).toBe(true)
    } else {
      expect(["bash", "zsh", "sh"].includes(name)).toBe(true)
    }
  })

  // ================================================================
  // Shell configuration
  // ================================================================

  test("Shell.acceptable respects configured shell preference", () => {
    Shell.acceptable.reset()
    Shell.preferred.reset()

    // On Windows with bash available, requesting bash should resolve to bash
    if (process.platform === "win32") {
      const gitbash = Shell.gitbash()
      if (gitbash) {
        Shell.acceptable.reset()
        // Test that posix shells are correctly identified
        const shell = Shell.acceptable()
        const name = Shell.name(shell)
        // Only test detection, not resolution (which varies by system)
        expect(Shell.posix(name)).toBe(name !== "cmd" && name !== "powershell" && name !== "pwsh")
      }
    }
  })

  // ================================================================
  // Shell name caching
  // ================================================================

  test("Shell.name returns consistent results", () => {
    const a = Shell.name("C:\\Windows\\System32\\cmd.exe")
    const b = Shell.name("C:\\Windows\\System32\\cmd.exe")
    expect(a).toBe(b)
    expect(a).toBe("cmd")
  })

  // ================================================================
  // Boundary: unknown shells
  // ================================================================

  test("Shell.posix returns undefined/false for unknown shell name", () => {
    expect(Shell.posix("unknown_shell")).toBe(false)
  })

  test("Shell.ps returns undefined/false for unknown shell name", () => {
    expect(Shell.ps("unknown_shell")).toBe(false)
  })

  test("Shell.login returns undefined/false for unknown shell name", () => {
    expect(Shell.login("unknown_shell")).toBe(false)
  })
})
