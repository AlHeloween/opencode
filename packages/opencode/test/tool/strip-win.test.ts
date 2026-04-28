import { expect, test } from "bun:test"
import { stripCommand } from "../../src/tool/strip-win"

test("strips CMD nul redirects", () => {
  expect(stripCommand("dir >nul", "powershell")).toBe("dir")
  expect(stripCommand("dir 2>nul", "powershell")).toBe("dir")
  expect(stripCommand("dir >nul 2>&1", "powershell")).toBe("dir 2>&1")
  expect(stripCommand("dir > nul", "powershell")).toBe("dir")
  expect(stripCommand("dir 2 > nul", "powershell")).toBe("dir")
})

test("strips PowerShell $null redirects", () => {
  expect(stripCommand("dir >$null", "powershell")).toBe("dir")
  expect(stripCommand("dir 2>$null", "powershell")).toBe("dir")
  expect(stripCommand("dir >$null 2>&1", "powershell")).toBe("dir 2>&1")
  expect(stripCommand("dir > $null", "powershell")).toBe("dir")
})

test("strips Unix /dev/null redirects", () => {
  expect(stripCommand("ls >/dev/null", "bash")).toBe("ls")
  expect(stripCommand("ls 2>/dev/null", "bash")).toBe("ls")
  expect(stripCommand("ls >/dev/null 2>&1", "bash")).toBe("ls 2>&1")
  expect(stripCommand("ls > /dev/null", "bash")).toBe("ls")
})

test("strips Out-Null pipe", () => {
  expect(stripCommand("echo hello | Out-Null", "powershell")).toBe("echo hello")
  expect(stripCommand("echo hello |Out-Null", "powershell")).toBe("echo hello")
  expect(stripCommand("echo hello Out-Null", "powershell")).toBe("echo hello")
})

test("preserves 2>&1 redirect", () => {
  expect(stripCommand("echo hello 2>&1", "powershell")).toBe("echo hello 2>&1")
  expect(stripCommand("dir >nul 2>&1", "powershell")).toBe("dir 2>&1")
})

test("preserves file redirects", () => {
  expect(stripCommand("echo hello > output.txt", "powershell")).toBe("echo hello > output.txt")
  expect(stripCommand("echo hello 2> error.log", "powershell")).toBe("echo hello 2> error.log")
})

test("preserves non-null commands", () => {
  expect(stripCommand("dir", "powershell")).toBe("dir")
  expect(stripCommand("ls -la", "bash")).toBe("ls -la")
  expect(stripCommand("echo $null_var", "powershell")).toBe("echo $null_var")
})
