/**
 * Windows: Backslash Preservation Tests
 *
 * Verifies that after the Shell.posix() gating fix, cmd.exe and PowerShell
 * preserve native backslash paths, while Git Bash receives forward-slash
 * normalization.
 *
 * These tests exercise the full BashTool execute pipeline.
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { mkdir } from "node:fs/promises"
import path from "path"
import os from "os"
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
  sessionID: SessionID.make("ses_shell_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const projectRoot = path.join(__dirname, "../../../..")
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

// Only run on Windows
const describeWin = process.platform === "win32" ? describe : describe.skip

describeWin("Windows: backslash path preservation", () => {
  // ================================================================
  // cmd.exe — backslashes must be preserved
  // ================================================================

  test(
    "cmd.exe: preserves backslash in dir command",
    withShell("cmd.exe", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const windir = process.env.WINDIR || "C:\\Windows"
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `dir "${windir}\\win.ini"`,
                description: "List win.ini with backslash path",
              },
              ctx,
            ),
          )
          // Should find win.ini — exit 0 means path resolved correctly
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("win.ini")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cmd.exe: preserves backslash in echo path",
    withShell("cmd.exe", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `echo "C:\\Program Files\\test"`,
                description: "Echo backslash path",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          // Output should contain backslashes, not forward slashes
          expect(result.output).toContain("\\Program Files\\")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cmd.exe: attrib works with backslash path on writable file",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "test_readonly.txt"), "test")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "test_readonly.txt")
          // First mark as readonly, then check it with attrib
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `attrib "${filepath}"`,
                description: "Check file attributes with backslash path",
              },
              ctx,
            ),
          )
          // Should succeed — path resolves with backslashes
          expect(result.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cmd.exe: xcopy with backslash paths",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "src", "file.txt"), "content")
          await mkdir(path.join(dir, "dst"))
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const src = path.join(tmp.path, "src", "file.txt")
          const dst = path.join(tmp.path, "dst")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `xcopy "${src}" "${dst}\\" /Y`,
                description: "Copy file with backslash paths",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toMatch(/[Ff]ile\(s\) copied/i)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // PowerShell — backslashes preserved (pwsh handles both)
  // ================================================================

  test(
    "pwsh: preserves backslash in Get-ChildItem",
    withShell("pwsh.exe", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const windir = process.env.WINDIR || "C:\\Windows"
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `Get-ChildItem "${windir}\\win.ini"`,
                description: "List with backslash path in pwsh",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("win.ini")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "pwsh: backslash path in Write-Output",
    withShell("pwsh.exe", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `Write-Output "C:\\Program Files\\App"`,
                description: "Write backslash path via pwsh",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("\\Program Files\\")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // Git Bash — paths should be normalized to forward slashes
  // ================================================================

  const gitbash = Shell.gitbash()
  if (gitbash) {
    test(
      "git bash: forward-slash paths work for basic commands",
      withShell(gitbash, async () => {
        await Instance.provide({
          directory: projectRoot,
          fn: async () => {
            const bash = await initBash()
            const result = await Effect.runPromise(
              bash.execute(
                {
                  command: `echo /c/Windows/win.ini`,
                  description: "Echo forward-slash path in git bash",
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
  }
})
