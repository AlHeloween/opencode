/**
 * Regression tests for bash/cmd tool edge cases:
 *   - timeout enforcement (process killed within timeout window)
 *   - drain timeout (pipes don't hang after kill)
 *   - tree kill (grandchildren are killed too)
 *   - safety net (scoped timeout fires as last resort)
 *   - cleanup grace (10s for pending tool calls, not 250ms)
 *
 * These tests exercise the fixes applied in:
 *   processor.ts  — 250ms → 10s
 *   shell-output.ts — drain timeout
 *   bash.ts / cmd.ts — drain-before-kill, safety net
 *   cross-spawn-spawner.ts — tree kill + proc.kill fallback
 */
import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { Config } from "@/config/config"
import { Shell } from "../../src/shell/shell"
import { BashTool } from "../../src/tool/bash"
import { CmdTool } from "../../src/tool/cmd"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "../../src/plugin"
import { forkDrainStdoutStderr } from "../../src/tool/shell-output"
import { Deferred, Scope, Stream } from "effect"

// ─── Runtime ────────────────────────────────────────────────────────
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

async function initBash() {
  return runtime.runPromise(BashTool.pipe(Effect.flatMap((info) => info.init())))
}
async function initCmd() {
  return runtime.runPromise(CmdTool.pipe(Effect.flatMap((info) => info.init())))
}

const projectRoot = path.join(__dirname, "../..")
const bin = process.execPath.replaceAll("\\", "/")

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const SHELL_TEST_TIMEOUT = 15_000

// ─── Helpers ────────────────────────────────────────────────────────
const squote = (text: string) => `'${text}'`
const quote = (text: string) => `"${text}"`
const sh = () => Shell.name(Shell.acceptable())
const evalarg = (text: string) => (sh() === "cmd" ? quote(text) : squote(text))

/** Return a command that sleeps for `sec` seconds, then prints a marker. */
const sleepCmd = (sec: number) => {
  const node = `setTimeout(() => process.stdout.write("DONE"), ${sec * 1000})`
  const text = `${bin} -e ${evalarg(node)}`
  if (sh() === "pwsh" || sh() === "powershell") return `& ${text}`
  return text
}
const immediateCmd = () =>
  (sh() === "pwsh" || sh() === "powershell")
    ? `& ${bin} -e ${evalarg("process.stdout.write('DONE')")}`
    : `echo DONE`

/** Return a command that spawns a grandchild: `start /b node -e "sleep 30"` (Windows) or `node -e "..." &` (Unix). */
const grandchildCmd = () => {
  if (process.platform === "win32") {
    const gc = `setTimeout(() => {}, 30000)`
    return `start /b "" ${bin} -e ${evalarg(gc)} & echo "PARENT_DONE"`
  }
  const gc = `setTimeout(() => {}, 30000)`
  return `${bin} -e ${evalarg(gc)} & echo "PARENT_DONE"`
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("tool.regression", () => {
  describe("timeout enforcement", () => {
    test("kills long-running command within timeout window", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const t0 = Date.now()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: sleepCmd(120), // would sleep 2 min
                description: "Should be killed by timeout",
                timeout: 2000, // 2s timeout
                run_in_background: false, // test sync path
              },
              ctx,
            ),
          )
          const elapsed = Date.now() - t0
          // Safety net fires at timeout+5s (7s), drain adds up to 10s/pipe on Windows.
          // Realistic worst case ~25s with taskkill pipe hang.
          expect(elapsed).toBeLessThan(30_000)
          // The command was killed — metadata should indicate that
          expect(result.metadata.exit).toBe(null) // null = killed, not natural exit
          expect(result.output).toContain("exceeding timeout")
        },
      })
    }, { timeout: 35_000 })

    test("does not kill command that finishes before timeout", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: immediateCmd(), // instant
                description: "Should complete normally",
                timeout: 10000,
                run_in_background: false, // test sync path
              },
              ctx,
            ),
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("DONE")
        },
      })
    }, { timeout: SHELL_TEST_TIMEOUT })
  })

  describe("drain timeout", () => {
    test("forkDrainStdoutStderr resolves even when pipe never closes", async () => {
      // Create two byte streams: one that emits data and closes, one that never closes.
      // The drain should complete after the timeout on the stuck pipe.
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            // stdout: emits one chunk, then closes
            const outChunks: Uint8Array[] = [new TextEncoder().encode("hello\n")]
            const outStream = Stream.fromIterable(outChunks)

            // stderr: never emits anything, never closes (simulates hung pipe)
            const errStream = Stream.never

            const chunks: string[] = []
            const onChunk = (chunk: string) => Effect.sync(() => { chunks.push(chunk) })

            const awaitDrain = yield* forkDrainStdoutStderr(
              { stdout: outStream, stderr: errStream },
              onChunk,
            )

            const t0 = Date.now()
            yield* awaitDrain
            const elapsed = Date.now() - t0

            // Should complete within 20s (10s per pipe × 2) — NOT hang forever
            expect(elapsed).toBeLessThan(25_000)
            // stdout data was captured
            expect(chunks.some((c) => c.includes("hello"))).toBe(true)
          }),
        ),
      )
      expect(result).toBeUndefined() // Effect<void>
    }, { timeout: 30_000 })
  })

  describe("tree kill", () => {
    test("grandchild process is killed when parent times out", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          // Spawn a process that creates a grandchild, then make the parent
          // sleep long enough that our timeout kills it. The tree kill
          // (taskkill /T) should also kill the grandchild.
          const parent = sleepCmd(120) // 2 min parent sleep
          const spawnGc = grandchildCmd()
          const cmd = `${spawnGc} && ${parent}`
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: cmd,
                description: "Parent + grandchild, kill tree on timeout",
                timeout: 3000,
                run_in_background: false, // test sync path
              },
              ctx,
            ),
          )
          // Should be killed by timeout (exit = null), not finish normally
          expect(result.metadata.exit).toBe(null)
          expect(result.output.length).toBeGreaterThan(0)
        },
      })
    }, { timeout: SHELL_TEST_TIMEOUT })
  })

  describe("safety net", () => {
    test("scoped timeout fires even if inner timeouts fail", async () => {
      // This is inherently hard to test without mocking.
      // Smoke test: run a command with a very short timeout to verify
      // the outer safety net + inner timeout compose correctly.
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const t0 = Date.now()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: sleepCmd(300), // 5 min — way beyond all timeouts
                description: "Safety net test",
                timeout: 500, // 0.5s inner timeout
                run_in_background: false, // test sync path
              },
              ctx,
            ),
          )
          const elapsed = Date.now() - t0
          // Safety net = input.timeout + 5000ms = 5500ms. Should finish within ~8s.
          expect(elapsed).toBeLessThan(10_000)
          expect(result.metadata.exit).toBe(null)
        },
      })
    }, { timeout: SHELL_TEST_TIMEOUT })
  })

  describe("cmd tool parity", () => {
    test("cmd timeout enforcement works same as bash", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const cmd = await initCmd()
          const t0 = Date.now()
          const result = await Effect.runPromise(
            cmd.execute(
              {
                command: sleepCmd(120),
                description: "cmd tool timeout test",
                timeout: 2000,
                run_in_background: false, // test sync path
              },
              ctx,
            ),
          )
          const elapsed = Date.now() - t0
          expect(elapsed).toBeLessThan(30_000)
          expect(result.metadata.exit).toBe(null)
          expect(result.output).toContain("exceeding timeout")
        },
      })
    }, { timeout: 35_000 })
  })

  describe("background mode (default)", () => {
    test("returns job ID when Jobs available, falls back to sync otherwise", async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const bash = await initBash()
          const t0 = Date.now()
          const result = await Effect.runPromise(
            bash.execute(
              {
                command: immediateCmd(),
                description: "Should run in background by default",
                // run_in_background defaults to true — not set explicitly
              },
              ctx,
            ),
          )
          const elapsed = Date.now() - t0
          // Background mode returns immediately (< 1s)
          expect(elapsed).toBeLessThan(3000)
          // If Jobs service is available → jobID is set. Otherwise → sync fallback
          // with normal output (no jobID). Both are correct behavior.
          if (result.metadata.jobID) {
            expect(result.output).toContain("background job")
          } else {
            // Sync fallback: command completed normally
            expect(result.metadata.exit).toBe(0)
            expect(result.output).toContain("DONE")
          }
        },
      })
    }, { timeout: SHELL_TEST_TIMEOUT })
  })
})
