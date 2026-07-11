import { describe, expect, test } from "bun:test"
import { normalizeCommandPaths } from "../../../src/tool/bash"

describe("normalizeCommandPaths — unit tests", () => {
  // ================================================================
  // Basic drive-letter normalization
  // ================================================================

  test("converts D:\\path → D:/path", () => {
    expect(normalizeCommandPaths("D:\\foo\\bar")).toBe("D:/foo\\bar")
  })

  test("converts C:\\Program Files → C:/Program Files", () => {
    expect(normalizeCommandPaths('C:\\Program Files\\app.exe')).toBe("C:/Program Files\\app.exe")
  })

  test("leaves D:/path unchanged (already forward slash)", () => {
    expect(normalizeCommandPaths("D:/foo/bar")).toBe("D:/foo/bar")
  })

  test("handles mixed separators: C:\\a/b → C:/a/b", () => {
    expect(normalizeCommandPaths("C:\\a/b\\c")).toBe("C:/a/b\\c")
  })

  // ================================================================
  // Multiple drive letters in one command
  // ================================================================

  test("handles multiple drive letters: C:\\src D:\\dst", () => {
    expect(normalizeCommandPaths("C:\\src D:\\dst")).toBe("C:/src D:/dst")
  })

  test("handles robocopy with multiple drive paths", () => {
    const cmd = 'robocopy "C:\\source\\dir" "D:\\dest\\dir" /MIR'
    const expected = 'robocopy "C:/source\\dir" "D:/dest\\dir" /MIR'
    expect(normalizeCommandPaths(cmd)).toBe(expected)
  })

  // ================================================================
  // Quoted paths
  // ================================================================

  test("handles quoted paths with spaces", () => {
    const cmd = 'attrib -r "C:\\Program Files\\app.exe"'
    const expected = 'attrib -r "C:/Program Files\\app.exe"'
    expect(normalizeCommandPaths(cmd)).toBe(expected)
  })

  test("handles single-quoted paths", () => {
    expect(normalizeCommandPaths("'D:\\data\\file.txt'")).toBe("'D:/data\\file.txt'")
  })

  // ================================================================
  // Commands without drive letters — passthrough
  // ================================================================

  test("passthrough: echo hello (no drive letter)", () => {
    expect(normalizeCommandPaths("echo hello")).toBe("echo hello")
  })

  test("passthrough: git status (no drive letter)", () => {
    expect(normalizeCommandPaths("git status")).toBe("git status")
  })

  test("passthrough: npm install (no drive letter)", () => {
    expect(normalizeCommandPaths("npm install")).toBe("npm install")
  })

  test("passthrough: ls -la /usr/bin", () => {
    expect(normalizeCommandPaths("ls -la /usr/bin")).toBe("ls -la /usr/bin")
  })

  test("passthrough: relative paths", () => {
    expect(normalizeCommandPaths(".\\script.ps1")).toBe(".\\script.ps1")
  })

  test("passthrough: UNC paths (\\\\server\\share)", () => {
    expect(normalizeCommandPaths("\\\\server\\share\\file.txt")).toBe("\\\\server\\share\\file.txt")
  })

  // ================================================================
  // Edge cases
  // ================================================================

  test("handles drive letter at end of string: echo C:", () => {
    // "C:" alone has no separator after it, regex doesn't match
    expect(normalizeCommandPaths("echo C:")).toBe("echo C:")
  })

  test("handles lowercase drive letters: c:\\path", () => {
    expect(normalizeCommandPaths("c:\\users\\file")).toBe("c:/users\\file")
  })

  test("handles mixed case: C:\\foo d:\\bar", () => {
    expect(normalizeCommandPaths("C:\\foo d:\\bar")).toBe("C:/foo d:/bar")
  })

  test("handles empty string", () => {
    expect(normalizeCommandPaths("")).toBe("")
  })

  test("does not convert colon in non-drive context: set VAR=value", () => {
    expect(normalizeCommandPaths("set VAR=C:\\path")).toBe("set VAR=C:/path")
  })

  test("does not convert colon in URL-like strings", () => {
    // "https:" is not [A-Za-z]: followed by \ or / — the regex requires
    // exactly one alpha char + colon + separator
    expect(normalizeCommandPaths("curl https://example.com")).toBe("curl https://example.com")
  })

  test("handles PowerShell FileSystem:: provider paths", () => {
    const cmd = "Get-Content -Path FileSystem::C:\\Windows\\win.ini"
    // The regex matches C:\ → C:/ but leaves the second \
    const result = normalizeCommandPaths(cmd)
    expect(result).toContain("C:/Windows")
  })

  // ================================================================
  // Commands with redirects
  // ================================================================

  test("handles command with >nul redirect", () => {
    expect(normalizeCommandPaths("dir C:\\foo >nul")).toBe("dir C:/foo >nul")
  })

  test("handles command with 2>&1 redirect", () => {
    expect(normalizeCommandPaths('attrib "C:\\file" 2>&1')).toBe('attrib "C:/file" 2>&1')
  })

  // ================================================================
  // Complex real-world commands
  // ================================================================

  test("icacls with path and grant", () => {
    const cmd = 'icacls "D:\\data\\folder" /grant "DOMAIN\\User:(OI)(CI)F" /T'
    expect(normalizeCommandPaths(cmd)).toBe('icacls "D:/data\\folder" /grant "DOMAIN\\User:(OI)(CI)F" /T')
  })

  test("takeown recursive", () => {
    const cmd = 'takeown /f "C:\\Program Files\\App" /r /d y'
    expect(normalizeCommandPaths(cmd)).toBe('takeown /f "C:/Program Files\\App" /r /d y')
  })

  test("xcopy with multiple paths", () => {
    const cmd = 'xcopy "C:\\source" "D:\\backup" /E /I /Y'
    expect(normalizeCommandPaths(cmd)).toBe('xcopy "C:/source" "D:/backup" /E /I /Y')
  })

  test("PowerShell Copy-Item with paths", () => {
    const cmd = 'Copy-Item -Path "C:\\src\\file.txt" -Destination "D:\\dst\\"'
    expect(normalizeCommandPaths(cmd)).toBe('Copy-Item -Path "C:/src\\file.txt" -Destination "D:/dst\\"')
  })

  test("cmd.exe built-in: copy", () => {
    expect(normalizeCommandPaths('copy "C:\\a.txt" "D:\\b.txt"')).toBe('copy "C:/a.txt" "D:/b.txt"')
  })

  test("cmd.exe built-in: move", () => {
    expect(normalizeCommandPaths('move "C:\\old" "D:\\new"')).toBe('move "C:/old" "D:/new"')
  })

  test("cmd.exe built-in: del", () => {
    expect(normalizeCommandPaths('del "C:\\temp\\*.tmp"')).toBe('del "C:/temp\\*.tmp"')
  })

  // ================================================================
  // Paths with environment variables — should pass through the var,
  // but normalize any drive-letter paths outside the var
  // ================================================================

  test("handles %VAR% expansion paths", () => {
    // The %VAR% isnt a drive letter, but C:\ after it IS
    expect(normalizeCommandPaths("%SystemRoot%\\System32\\cmd.exe")).toBe("%SystemRoot%\\System32\\cmd.exe")
  })

  test("handles paths with env var drive prefix", () => {
    // If an env var resolves to a drive letter path, it appears as raw text
    // %HOMEDRIVE%%HOMEPATH% — no drive letter here, passes through
    expect(normalizeCommandPaths("dir %HOMEDRIVE%%HOMEPATH%")).toBe("dir %HOMEDRIVE%%HOMEPATH%")
  })

  test("PowerShell $env: paths passthrough (no colon after single letter)", () => {
    // $env:WINDIR/win.ini — $env: has colon but not single-letter, passes through
    expect(normalizeCommandPaths("Get-Content $env:WINDIR/win.ini")).toBe("Get-Content $env:WINDIR/win.ini")
  })

  // ================================================================
  // NUL device and special file names
  // ================================================================

  test("handles nul device", () => {
    expect(normalizeCommandPaths("type C:\\file.txt > nul")).toBe("type C:/file.txt > nul")
  })

  test("handles CON device", () => {
    expect(normalizeCommandPaths("copy CON C:\\output.txt")).toBe("copy CON C:/output.txt")
  })

  // ================================================================
  // Very long paths (>260 chars)
  // ================================================================

  test("handles long paths", () => {
    const longSubdir = "subdir\\".repeat(20)
    const cmd = `dir "C:\\${longSubdir}file.txt"`
    const result = normalizeCommandPaths(cmd)
    expect(result).toStartWith('dir "C:/')
    expect(result).toContain("file.txt")
  })

  // ================================================================
  // Paths with trailing backslash
  // ================================================================

  test("handles trailing backslash", () => {
    expect(normalizeCommandPaths("dir C:\\foo\\")).toBe("dir C:/foo\\")
  })

  test("handles trailing forward slash", () => {
    expect(normalizeCommandPaths("dir C:/foo/")).toBe("dir C:/foo/")
  })

  // ================================================================
  // Paths with multiple consecutive separators
  // ================================================================

  test("handles double backslash", () => {
    // C:\\\foo → regex matches C:\ and replaces with C:/, leaving /\foo
    expect(normalizeCommandPaths("dir C:\\\\foo")).toBe("dir C:/\\foo")
  })

  // ================================================================
  // Shebang / interpreter lines
  // ================================================================

  test("bash shebang passthrough", () => {
    expect(normalizeCommandPaths("#!/bin/bash")).toBe("#!/bin/bash")
  })
})
