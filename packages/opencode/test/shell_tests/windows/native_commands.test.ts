/**
 * Windows: Native Command Tests
 *
 * Verifies that native Windows commands (attrib, icacls, takeown, robocopy)
 * work correctly with backslash paths through the BashTool.
 *
 * These commands are known to be sensitive to path separator format —
 * forward slashes can cause "File not found" or "Invalid parameter" errors.
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
  sessionID: SessionID.make("ses_native_cmd"),
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

describeWin("Windows: native command path handling", () => {
  // ================================================================
  // attrib — read-only attribute command
  // ================================================================

  test(
    "attrib: lists attributes with backslash path on temp file",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "test.txt"), "content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "test.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `attrib "${filepath}"`,
                description: "Check file attributes",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          // Should show A (archive) attribute for a normal file
          expect(result.output).toMatch(/[A]?\s/)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "attrib: +r and -r with backslash path",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "ro_test.txt"), "readonly content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "ro_test.txt")

          // Set readonly
          const setResult = await Effect.runPromise(
            bash.execute(
              {
                command: `attrib +r "${filepath}"`,
                description: "Set readonly attribute",
              },
              ctx,
            ),
          )
          expect(setResult.metadata.exit).toBe(0)

          // Verify it's readonly
          const checkResult = await Effect.runPromise(
            bash.execute(
              {
                command: `attrib "${filepath}"`,
                description: "Check readonly attribute set",
              },
              ctx,
            ),
          )
          expect(checkResult.metadata.exit).toBe(0)
          expect(checkResult.output).toContain("R")

          // Remove readonly
          const unsetResult = await Effect.runPromise(
            bash.execute(
              {
                command: `attrib -r "${filepath}"`,
                description: "Remove readonly attribute",
              },
              ctx,
            ),
          )
          expect(unsetResult.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // icacls — ACL management (non-destructive: just read)
  // ================================================================

  test(
    "icacls: reads ACLs with backslash path",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "acl_test.txt"), "content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "acl_test.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `icacls "${filepath}"`,
                description: "Read file ACLs",
              },
              ctx,
            ),
          )
          // icacls with just a path should succeed (read-only operation)
          expect(result.metadata.exit).toBe(0)
          expect(result.output.length).toBeGreaterThan(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // robocopy — robust file copy (non-destructive: /L list-only mode)
  // ================================================================

  test(
    "robocopy: /L list mode with backslash paths",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await mkdir(path.join(dir, "src"))
          await mkdir(path.join(dir, "dst"))
          await Bun.write(path.join(dir, "src", "file.txt"), "content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const src = path.join(tmp.path, "src")
          const dst = path.join(tmp.path, "dst")
          // /L = list only (no actual copy), /NJH /NJS = no header/summary
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `robocopy "${src}" "${dst}" /L /NJH /NJS`,
                description: "List robocopy with backslash paths",
              },
              ctx,
            ),
          )
          // robocopy exit code 0 or 1 both indicate success (1 = files copied)
          expect([0, 1]).toContain(result.metadata.exit!)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // takeown — only on non-system files
  // ================================================================

  test(
    "takeown: reads ownership with backslash path on temp file",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "owned.txt"), "content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "owned.txt")
          // takeown /F with just path should show ownership info
          // Note: takeown may fail if not admin; we just verify the path resolves
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `takeown /F "${filepath}"`,
                description: "Take ownership of temp file",
              },
              ctx,
            ),
          )
          // exit 0 = success, exit 1 = may require elevation
          // Either way, we verify the command executed (not "file not found" due to path issues)
          expect(result.output).not.toContain("File not found")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // cacls — legacy ACL display
  // ================================================================

  test(
    "cacls: reads ACLs with backslash path",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "cacls_test.txt"), "content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "cacls_test.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `cacls "${filepath}"`,
                description: "Read file ACLs via cacls",
              },
              ctx,
            ),
          )
          // cacls with just a path is read-only and should succeed
          expect(result.metadata.exit).toBe(0)
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  // ================================================================
  // cmd built-ins: copy, move, del
  // ================================================================

  test(
    "cmd.exe built-in copy with backslash paths",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "original.txt"), "original content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const src = path.join(tmp.path, "original.txt")
          const dst = path.join(tmp.path, "copied.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `copy "${src}" "${dst}"`,
                description: "Copy file via cmd built-in",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("file(s) copied")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cmd.exe built-in move with backslash paths",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "move_me.txt"), "move content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const src = path.join(tmp.path, "move_me.txt")
          const dst = path.join(tmp.path, "moved.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `move "${src}" "${dst}"`,
                description: "Move file via cmd built-in",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("file(s) moved")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cmd.exe built-in del with backslash path",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "delete_me.txt"), "delete content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "delete_me.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `del "${filepath}"`,
                description: "Delete file via cmd built-in",
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

  // ================================================================
  // dir / findstr — common cmd tools with paths
  // ================================================================

  test(
    "cmd.exe dir with backslash path to specific file",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "nested", "deep.txt"), "deep content")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const subdir = path.join(tmp.path, "nested")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `dir "${subdir}"`,
                description: "List directory with backslash path",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("deep.txt")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )

  test(
    "cmd.exe type with backslash path",
    withShell("cmd.exe", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "type_test.txt"), "Hello from type!")
        },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const bash = await initBash()
          const filepath = path.join(tmp.path, "type_test.txt")
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: `type "${filepath}"`,
                description: "Type file with backslash path",
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("Hello from type!")
        },
      })
    }),
    { timeout: SHELL_TEST_TIMEOUT },
  )
})
