/**
 * Windows: Edge Cases
 *
 * Tests for UNC paths, drive-relative paths, reserved names,
 * special characters, long paths, and other Windows-specific edge cases.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { mkdir } from "node:fs/promises"
import path from "path"
import { Config } from "../../../src/config/config"
import { Shell } from "../../../src/shell/shell"
import { BashTool } from "../../../src/tool/bash"
import { Instance } from "../../../src/project/instance"
import { tmpdir } from "../../fixture/fixture"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "../../../src/tool/truncate"
import { Plugin } from "../../../src/plugin"
import { Agent } from "../../../src/agent/agent"
import { SessionID, MessageID } from "../../../src/session/schema"
import { normalizeCommandPaths } from "../../../src/tool/bash"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Plugin.defaultLayer,
    Truncate.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
  ),
)

function initBash() {
  return runtime.runPromise(BashTool.pipe(Effect.flatMap((info) => info.init())))
}

const ctx = {
  sessionID: SessionID.make("ses_edge"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const SHELL_TEST_TIMEOUT = 20_000

function withShell(shell: string, fn: () => Promise<void>) {
  return async () => {
    const prev = process.env.SHELL
    process.env.SHELL = shell
    Shell.acceptable.reset()
    Shell.preferred.reset()
    try {
      await fn()
    } finally {
      if (prev === undefined) delete process.env.SHELL
      else process.env.SHELL = prev
      Shell.acceptable.reset()
      Shell.preferred.reset()
    }
  }
}

const describeWin = process.platform === "win32" ? describe : describe.skip

describe("normalizeCommandPaths: Windows edge cases", () => {
  // ================================================================
  // UNC paths
  // ================================================================

  test("UNC paths are not modified", () => {
    const inputs = [
      "\\\\server\\share\\file.txt",
      "\\\\localhost\\C$\\Windows\\win.ini",
      "dir \\\\server\\share",
      'xcopy "\\\\server\\share\\src" "\\\\server\\share\\dst"',
    ]
    for (const input of inputs) {
      const result = normalizeCommandPaths(input)
      // UNC paths don't match the [A-Za-z]:[\\/] pattern
      expect(result).toBe(input)
    }
  })

  // ================================================================
  // Drive-relative paths (no separator after drive letter)
  // ================================================================

  test("drive-relative paths: C:file (no separator) not modified", () => {
    // "C:file.txt" has no \ or / after the colon — not matched by the regex
    const inputs = ["C:file.txt", "D:data.csv", "cd C:subdir"]
    for (const input of inputs) {
      const result = normalizeCommandPaths(input)
      expect(result).toBe(input)
    }
  })

  test("drive-relative paths: C:..\\parent (separator after colon)", () => {
    // "C:..\parent" — the regex matches C:\? No, "C:.." doesn't match [A-Za-z]:[\\/]
    const result = normalizeCommandPaths("C:..\\parent")
    expect(result).toBe("C:..\\parent")
  })

  test("mixed drive-relative with separator: C:.\\file", () => {
    // "C:.\file" — C:.\ matches? No, "." is not [\\/]
    expect(normalizeCommandPaths("C:.\\file")).toBe("C:.\\file")
  })

  // ================================================================
  // Mixed separator styles in paths
  // ================================================================

  test("mixed forward and backslash in same path", () => {
    const result = normalizeCommandPaths("C:\\a/b\\c/d\\e")
    // Only converts C:\ → C:/, the rest stays as-is
    expect(result).toBe("C:/a/b\\c/d\\e")
  })

  test("already-normalized paths pass through", () => {
    expect(normalizeCommandPaths("C:/Users/file.txt")).toBe("C:/Users/file.txt")
    expect(normalizeCommandPaths("D:/data/config.json")).toBe("D:/data/config.json")
  })

  // ================================================================
  // Spaces in paths — quoting preserves structure
  // ================================================================

  test("quoted path with spaces preserves backslash inside quotes", () => {
    const input = '"C:\\Program Files (x86)\\App\\file.exe"'
    const result = normalizeCommandPaths(input)
    // Only C:\ becomes C:/ inside the quotes
    expect(result).toBe('"C:/Program Files (x86)\\App\\file.exe"')
  })

  test("single-quoted paths with spaces", () => {
    const input = "'D:\\My Documents\\report.pdf'"
    const result = normalizeCommandPaths(input)
    expect(result).toBe("'D:/My Documents\\report.pdf'")
  })

  test("unquoted path with spaces may break in shell but normalize still works", () => {
    // normalizeCommandPaths just does string replacement, doesn't parse quoting
    const input = "C:\\My Data\\file.txt"
    const result = normalizeCommandPaths(input)
    expect(result).toBe("C:/My Data\\file.txt")
  })

  // ================================================================
  // Reserved device names (CON, NUL, PRN, AUX, COM1-9, LPT1-9)
  // ================================================================

  test("reserved names are not mistaken for drive letters", () => {
    // COM1: looks like drive letter but regex only matches single alpha char
    expect(normalizeCommandPaths("type COM1:")).toBe("type COM1:")
    expect(normalizeCommandPaths("copy CON: output.txt")).toBe("copy CON: output.txt")
    expect(normalizeCommandPaths("echo test > PRN:")).toBe("echo test > PRN:")
    expect(normalizeCommandPaths("mode LPT1:")).toBe("mode LPT1:")
  })

  // ================================================================
  // Multiline commands
  // ================================================================

  test("multiline command with paths", () => {
    const input = `echo C:\\first
echo D:\\second`
    const result = normalizeCommandPaths(input)
    expect(result).toContain("C:/first")
    expect(result).toContain("D:/second")
  })

  // ================================================================
  // PowerShell-specific path syntax
  // ================================================================

  test("PowerShell provider paths", () => {
    const inputs = [
      "Get-Content FileSystem::C:\\Windows\\win.ini",
      "Get-ChildItem Registry::HKEY_LOCAL_MACHINE\\Software",
      "Set-Location Cert:\\CurrentUser\\My",
    ]
    for (const input of inputs) {
      const result = normalizeCommandPaths(input)
      // FileSystem::C:\ → FileSystem::C:/
      if (input.includes("FileSystem::")) {
        expect(result).toContain("FileSystem::C:/")
      }
    }
  })

  test("PowerShell variable paths", () => {
    expect(normalizeCommandPaths('"$HOME\\Documents"')).toBe('"$HOME\\Documents"')
    expect(normalizeCommandPaths("${env:ProgramFiles}\\app.exe")).toBe("${env:ProgramFiles}\\app.exe")
    expect(normalizeCommandPaths("$PWD\\data\\config.json")).toBe("$PWD\\data\\config.json")
  })

  // ================================================================
  // Paths with environment variables (cmd.exe style)
  // ================================================================

  test("cmd.exe env var paths", () => {
    expect(normalizeCommandPaths("%WINDIR%\\System32\\cmd.exe")).toBe("%WINDIR%\\System32\\cmd.exe")
    expect(normalizeCommandPaths("%ProgramFiles%\\App\\app.exe")).toBe("%ProgramFiles%\\App\\app.exe")
    expect(normalizeCommandPaths("dir %USERPROFILE%\\Documents")).toBe("dir %USERPROFILE%\\Documents")
  })

  test("mixed env var and literal drive paths", () => {
    const result = normalizeCommandPaths("set VAR=C:\\path && echo %VAR%")
    expect(result).toBe("set VAR=C:/path && echo %VAR%")
  })

  // ================================================================
  // Long paths (>260 chars)
  // ================================================================

  test("long paths with deep nesting", () => {
    const deep = "subdir\\".repeat(30)
    const input = `dir "C:\\${deep}file.txt"`
    const result = normalizeCommandPaths(input)
    expect(result.startsWith('dir "C:/')).toBe(true)
    expect(result.endsWith('file.txt"')).toBe(true)
  })

  // ================================================================
  // Paths with trailing dot (allowed in Windows)
  // ================================================================

  test("paths with trailing dot", () => {
    // Windows allows paths like "C:\dir." (though not recommended)
    const result = normalizeCommandPaths("C:\\dir.")
    expect(result).toBe("C:/dir.")
  })

  // ================================================================
  // Paths with multiple spaces
  // ================================================================

  test("paths with consecutive spaces", () => {
    const input = '"C:\\Program   Files\\App"'
    const result = normalizeCommandPaths(input)
    expect(result).toBe('"C:/Program   Files\\App"')
  })
})

describeWin("Windows: edge case integration", () => {
  // ================================================================
  // Spaces in paths — cmd.exe integration
  // ================================================================

  test(
    "cmd.exe: directories with spaces in name",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await mkdir(path.join(dir, "my spaced folder"))
          await Bun.write(path.join(dir, "my spaced folder", "file.txt"), "content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const spacedDir = path.join(tmp.path, "my spaced folder")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `dir "${spacedDir}"`,
                description: "List directory with spaces",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("file.txt")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // Parentheses in paths (common in 64-bit program paths)
  // ================================================================

  test(
    "cmd.exe: paths with parentheses",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await mkdir(path.join(dir, "Program Files (x86)"))
          await Bun.write(path.join(dir, "Program Files (x86)", "test.dll"), "dll")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const parenDir = path.join(tmp.path, "Program Files (x86)")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `dir "${parenDir}"`,
                description: "List directory with parentheses",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("test.dll")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // User's exact reported failing commands
  // ================================================================

  test(
    "cmd.exe: attrib -r on temp file (user's reported pattern)",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "codex.exe"), "fake executable")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "codex.exe")
          // Set readonly first
          await Effect.runPromise(
            bash.execute(
              {
                command: `attrib +r "${filepath}"`,
                description: "Set readonly for test",
              },
              ctx,
            ),
          )
          // Now remove readonly — this is the user's pattern
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `attrib -r "${filepath}"`,
                description: "Remove readonly (user pattern)",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cmd.exe: takeown /f on temp dir (user's reported pattern)",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await mkdir(path.join(dir, "test_app"))
          await Bun.write(path.join(dir, "test_app", "resources", "app.exe"), "fake")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const folderPath = path.join(tmp.path, "test_app")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `takeown /f "${folderPath}" /r /d y`,
                description: "Take ownership recursive (user pattern)",
              },
              ctx,
            ),
          )
          // Verify the command didn't fail with "File not found" due to path issues
          expect(result.output).not.toContain("File not found")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )
})
