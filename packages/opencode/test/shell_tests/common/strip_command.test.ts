import { describe, expect, test } from "bun:test"
import { stripCommand } from "../../../src/tool/strip-win"

describe("stripCommand — cross-platform", () => {
  // ================================================================
  // /dev/null redirects (bash/Unix shells)
  // ================================================================

  test("strips >/dev/null from bash commands", () => {
    expect(stripCommand("echo hello >/dev/null", "bash").command).toBe("echo hello")
    expect(stripCommand("cat file 2>/dev/null", "bash").command).toBe("cat file")
    expect(stripCommand("ls -la 1>/dev/null", "bash").command).toBe("ls -la")
  })

  test("strips combined /dev/null redirects", () => {
    expect(stripCommand("cmd >/dev/null 2>&1", "bash").command).toBe("cmd 2>&1")
  })

  test("does not strip /dev/null in remote SSH commands", () => {
    const result = stripCommand("ssh user@host 'cat file >/dev/null'", "bash")
    expect(result.command).toContain("/dev/null")
  })

  test("preserves /dev/null in scp commands", () => {
    const result = stripCommand("scp file user@host:/dev/null", "bash")
    expect(result.command).toContain("/dev/null")
  })

  test("preserves /dev/null in cmd_runner commands", () => {
    const result = stripCommand("cmd_runner start -- some-cmd >/dev/null", "bash")
    expect(result.command).toContain("/dev/null")
  })

  // ================================================================
  // >nul redirects (cmd.exe Windows)
  // ================================================================

  test("strips >nul from cmd commands", () => {
    expect(stripCommand("echo hello >nul", "cmd").command).toBe("echo hello")
    expect(stripCommand("dir 2>nul", "cmd").command).toBe("dir")
    expect(stripCommand("type file.txt 1>nul", "cmd").command).toBe("type file.txt")
  })

  test("strips >nul with spaces", () => {
    expect(stripCommand("echo hello  >  nul", "cmd").command).toBe("echo hello")
    expect(stripCommand("dir 2 > nul", "cmd").command).toBe("dir")
  })

  // ================================================================
  // >$null / Out-Null redirects (PowerShell)
  // ================================================================

  test("strips >$null from PowerShell commands", () => {
    expect(stripCommand("echo hello >$null", "pwsh").command).toBe("echo hello")
    expect(stripCommand("Get-ChildItem 2>$null", "pwsh").command).toBe("Get-ChildItem")
    expect(stripCommand("ls 1>$null", "pwsh").command).toBe("ls")
  })

  test("strips | Out-Null pipes from PowerShell commands", () => {
    expect(stripCommand("echo hello | Out-Null", "pwsh").command).toBe("echo hello")
    expect(stripCommand("Get-Process | Out-Null", "pwsh").command).toBe("Get-Process")
  })

  test("strips standalone Out-Null", () => {
    expect(stripCommand("some-cmd Out-Null", "pwsh").command).toBe("some-cmd")
  })

  // ================================================================
  // Commands without redirects — passthrough
  // ================================================================

  test("does not modify commands without redirects", () => {
    expect(stripCommand("echo hello world", "bash").command).toBe("echo hello world")
    expect(stripCommand("git status", "bash").command).toBe("git status")
    expect(stripCommand("npm install", "cmd").command).toBe("npm install")
    expect(stripCommand("Get-Process", "pwsh").command).toBe("Get-Process")
  })

  test("preserves meaningful redirect targets", () => {
    expect(stripCommand("echo output > file.txt", "bash").command).toBe("echo output > file.txt")
    expect(stripCommand("cat /dev/null", "bash").command).toBe("cat /dev/null")
    expect(stripCommand("write-output 'test' > real_file.txt", "pwsh").command).toBe("write-output 'test' > real_file.txt")
  })

  // ================================================================
  // Multiple redirect combinations
  // ================================================================

  test("strips multiple null redirects", () => {
    // Both 2>nul and >nul stripped
    const result = stripCommand("mycommand 2>nul >nul", "cmd")
    expect(result.command).toBe("mycommand")
  })

  test("strips /dev/null but preserves file redirect", () => {
    const result = stripCommand("cmd >/dev/null 2>error.log", "bash")
    expect(result.command).toBe("cmd 2>error.log")
  })

  // ================================================================
  // Whitespace normalization
  // ================================================================

  test("collapses multiple spaces after stripping", () => {
    expect(stripCommand("echo   hello   world", "bash").command).toBe("echo hello world")
  })

  test("trims leading/trailing whitespace after stripping", () => {
    const result = stripCommand("  echo hello  >/dev/null  ", "bash")
    expect(result.command).toBe("echo hello")
  })

  // ================================================================
  // Edge cases
  // ================================================================

  test("handles empty string", () => {
    const result = stripCommand("", "bash")
    expect(result.command).toBe("")
    expect(result.converted).toBe(false)
  })

  test("handles whitespace-only string", () => {
    const result = stripCommand("   ", "bash")
    expect(result.command).toBe("")
  })

  test("handles command that is only a redirect", () => {
    const result = stripCommand("> /dev/null", "bash")
    expect(result.command).toBe("")
  })

  // ================================================================
  // Case insensitivity
  // ================================================================

  test("handles case variations of nul redirect", () => {
    expect(stripCommand("dir >NUL", "cmd").command).toBe("dir")
    expect(stripCommand("dir >Nul", "cmd").command).toBe("dir")
  })

  test("handles case variations of Out-Null", () => {
    expect(stripCommand("cmd | out-null", "pwsh").command).toBe("cmd")
    expect(stripCommand("cmd | OUT-NULL", "pwsh").command).toBe("cmd")
  })
})
