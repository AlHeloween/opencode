/**
 * P2: Lock cmd_runner send payload constitution policy (SSH + interactive TUI).
 *
 * Bare shell: FILE_ENUMERATOR hard-block (platform-aware).
 * After `cmd_runner send … --`: payload is session input — no enumeration
 * hard-block; brutal DESTRUCTIVE still needs permission.
 */
import { expect, test, describe } from "bun:test"
import { Effect } from "effect"
import { MessageID, SessionID } from "@/session/schema"
import { Constitution } from "@/session/constitution"
import {
  splitCmdRunnerSend,
  stripCmdRunnerSendPayload,
  enforceDestructiveShell,
  enforceBrutalDestructiveOnly,
} from "@/tool/shell-constitution"

const isWin = process.platform === "win32"
/** Platform-native enumerator that must hard-block on bare shell. */
const bareEnum = isWin ? "dir /a" : "ls -la"
/** Enumeration that is never hard-blocked on this platform (false-positive guard). */
const foreignEnum = isWin ? "ls -la" : "dir /a"

const ctx = () => ({
  sessionID: SessionID.descending(),
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [] as const,
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("splitCmdRunnerSend", () => {
  test("extracts payload after send … --", () => {
    const s = splitCmdRunnerSend("cmd_runner send rid -- ls -la")
    expect(s.payload).toBe("ls -la")
    expect(s.shellScan.endsWith("-- ") || s.shellScan.endsWith("--")).toBe(true)
    expect(s.shellScan).toContain("cmd_runner send")
  })

  test("cmd_runner.exe and multiline payload", () => {
    const s = splitCmdRunnerSend("cmd_runner.exe send abc --\nrm -rf /tmp/x")
    expect(s.payload).toBe("rm -rf /tmp/x")
  })

  test("no -- → payload undefined, full command is shellScan", () => {
    const s = splitCmdRunnerSend("cmd_runner start --cwd dist -- opencode.exe")
    // start uses -- but pattern is send-only; no payload split
    expect(s.payload).toBeUndefined()
    expect(s.shellScan).toBe("cmd_runner start --cwd dist -- opencode.exe")
  })

  test("send without trailing payload after --", () => {
    const s = splitCmdRunnerSend("cmd_runner send rid -- ")
    expect(s.payload).toBeUndefined()
  })

  test("stripCmdRunnerSendPayload matches shellScan", () => {
    const cmd = "cmd_runner send x -- dir /s"
    expect(stripCmdRunnerSendPayload(cmd)).toBe(splitCmdRunnerSend(cmd).shellScan)
  })
})

describe("guardBrutalDestructive vs bare guardCommand", () => {
  test("payload enumeration is not gated; bare platform enum is blocked", () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      expect(Constitution.guardBrutalDestructive(bareEnum).needsDestructivePermission).toBe(false)
      expect(Constitution.guardBrutalDestructive(bareEnum).blocked).toBe(false)
      expect(Constitution.guardBrutalDestructive("find . -type f").needsDestructivePermission).toBe(false)

      expect(Constitution.guardCommand(bareEnum).blocked).toBe(true)
      // Foreign-platform binary name is not an enumerator on this OS
      expect(Constitution.guardCommand(foreignEnum).blocked).toBe(false)

      const rm = Constitution.guardBrutalDestructive("rm -rf /tmp/x")
      expect(rm.needsDestructivePermission).toBe(true)
      expect(rm.blocked).toBe(false)

      expect(Constitution.guardBrutalDestructive("git checkout main").needsDestructivePermission).toBe(true)
      expect(Constitution.guardBrutalDestructive("fossil commit -m x").needsDestructivePermission).toBe(true)
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })
})

describe("enforceDestructiveShell + send payload", () => {
  test("bare platform enumerator hard-blocks before spawn", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      await expect(
        Effect.runPromise(enforceDestructiveShell(bareEnum, ctx() as any)),
      ).rejects.toThrow(/list tool|BLOCKED/i)
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("cmd_runner send -- enumerator payload does not hard-block", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      await Effect.runPromise(
        enforceDestructiveShell(`cmd_runner send rid -- ${bareEnum}`, ctx() as any),
      )
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("cmd_runner send -- rm -rf asks destructive permission", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    const asked: string[] = []
    try {
      await Effect.runPromise(
        enforceDestructiveShell("cmd_runner send rid -- rm -rf /tmp/x", {
          ...ctx(),
          ask: (req: { permission?: string }) => {
            asked.push(req.permission ?? "")
            return Effect.void
          },
        } as any),
      )
      expect(asked.some((p) => p.includes("destructive") || p.length > 0)).toBe(true)
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("enforceBrutalDestructiveOnly asks only for brutal DESTRUCTIVE", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    const asked: string[] = []
    try {
      await Effect.runPromise(
        enforceBrutalDestructiveOnly(bareEnum, {
          ...ctx(),
          ask: () => {
            asked.push("enum")
            return Effect.void
          },
        } as any),
      )
      expect(asked).toEqual([])

      await Effect.runPromise(
        enforceBrutalDestructiveOnly("git checkout main", {
          ...ctx(),
          ask: (req: { permission?: string }) => {
            asked.push(req.permission ?? "x")
            return Effect.void
          },
        } as any),
      )
      expect(asked.length).toBeGreaterThan(0)
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })

  test("legacy run path: git commit message with fossil is not FOSSIL_MUTATE", async () => {
    const prev = process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
    try {
      // run tool reconstructs argvLine — same as guardCommand first-token path
      await Effect.runPromise(
        enforceDestructiveShell(
          'git commit -m "fix(fossil): fossil clean --force replaced"',
          ctx() as any,
        ),
      )
    } finally {
      if (prev === undefined) delete process.env["OPENCODE_ALLOW_DESTRUCTIVE"]
      else process.env["OPENCODE_ALLOW_DESTRUCTIVE"] = prev
    }
  })
})
