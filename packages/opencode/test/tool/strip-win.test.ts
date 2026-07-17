import { expect, test } from "bun:test"
import { stripCommand } from "../../src/tool/strip-win"

test("strips CMD nul redirects", () => {
  expect(stripCommand("dir >nul", "powershell").command).toBe("dir")
  expect(stripCommand("dir 2>nul", "powershell").command).toBe("dir")
  expect(stripCommand("dir >nul 2>&1", "powershell").command).toBe("dir 2>&1")
  expect(stripCommand("dir > nul", "powershell").command).toBe("dir")
  expect(stripCommand("dir 2 > nul", "powershell").command).toBe("dir")
})

test("strips PowerShell $null redirects", () => {
  expect(stripCommand("dir >$null", "powershell").command).toBe("dir")
  expect(stripCommand("dir 2>$null", "powershell").command).toBe("dir")
  expect(stripCommand("dir >$null 2>&1", "powershell").command).toBe("dir 2>&1")
  expect(stripCommand("dir > $null", "powershell").command).toBe("dir")
})

test("converts Unix /dev/null redirects to nul on Windows", () => {
  const isWindows = process.platform === "win32"
  if (isWindows) {
    const result = stripCommand("ls 2>/dev/null", "bash")
    expect(result.command).toBe("ls")
    expect(result.converted).toBe(true)
    expect(result.message).toContain("/dev/null converted to nul")
  }
})

test("preserves Unix /dev/null redirects on Linux/macOS", () => {
  const isWindows = process.platform === "win32"
  if (!isWindows) {
    expect(stripCommand("ls >/dev/null", "bash").command).toBe("ls >/dev/null")
    expect(stripCommand("ls 2>/dev/null", "bash").command).toBe("ls 2>/dev/null")
  }
})

test("preserves /dev/null in SSH commands", () => {
  const result = stripCommand("ssh user@host 'ls 2>/dev/null'", "bash")
  expect(result.command).toContain("/dev/null")
  expect(result.converted).toBe(false)
})

test("strips Out-Null pipe", () => {
  expect(stripCommand("echo hello | Out-Null", "powershell").command).toBe("echo hello")
  expect(stripCommand("echo hello |Out-Null", "powershell").command).toBe("echo hello")
  expect(stripCommand("echo hello Out-Null", "powershell").command).toBe("echo hello")
})

test("preserves 2>&1 redirect", () => {
  expect(stripCommand("echo hello 2>&1", "powershell").command).toBe("echo hello 2>&1")
  expect(stripCommand("dir >nul 2>&1", "powershell").command).toBe("dir 2>&1")
  // TS / bun / tsc — merge must never be eaten
  expect(stripCommand("bun run build.ts 2>&1", "cmd").command).toBe("bun run build.ts 2>&1")
  expect(stripCommand("tsc -b 2>&1", "cmd").command).toBe("tsc -b 2>&1")
  expect(stripCommand("node script.js 1>&2", "cmd").command).toBe("node script.js 1>&2")
  expect(stripCommand("tsc 2>&1 | more", "cmd").command).toBe("tsc 2>&1 | more")
})

test("preserves file redirects", () => {
  expect(stripCommand("echo hello > output.txt", "powershell").command).toBe("echo hello > output.txt")
  expect(stripCommand("echo hello 2> error.log", "powershell").command).toBe("echo hello 2> error.log")
})

test("preserves non-null commands", () => {
  expect(stripCommand("dir", "powershell").command).toBe("dir")
  expect(stripCommand("ls -la", "bash").command).toBe("ls -la")
  expect(stripCommand("echo $null_var", "powershell").command).toBe("echo $null_var")
})
