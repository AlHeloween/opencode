/**
 * P2: Lock cmd_runner send payload constitution policy (SSH + interactive TUI).
 *
 * Bare shell: FILE_ENUMERATOR hard-block (platform-aware).
 * After `cmd_runner send … --`: payload is session input — no enumeration
 * hard-block; brutal DESTRUCTIVE still needs permission.
 */
import { expect, test, describe, beforeEach, afterEach } from "bun:test"
import { Effect } from "effect"
import { MessageID, SessionID } from "@/session/schema"
import { Constitution } from "@/session/constitution"
import {
  splitCmdRunnerSend,
  stripCmdRunnerSendPayload,
  enforceDestructiveShell,
  enforceBrutalDestructiveOnly,
  shouldRouteViaCmdRunner,
  autoWrapCmdRunner,
  autoWrapBinary,
  enforceBinaryViaCmdRunner,
  setCmdRunnerProbe,
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

describe("cmd_runner auto-wrap (constitution routing)", () => {
  // Routing tests assume cmd_runner IS available; graceful-skip tests below
  // cover the missing-wrapper path. Reset in afterEach via the undefined probe.
  beforeEach(() => setCmdRunnerProbe(true))
  afterEach(() => setCmdRunnerProbe(undefined))

  test("bun test is auto-wrapped (crash-prone test runner)", () => {
    const r = autoWrapCmdRunner("bun test test/foo.test.ts")
    expect(r.wrapped).toBe(true)
    expect(r.command).toBe("cmd_runner start -- bun test test/foo.test.ts")
    expect(shouldRouteViaCmdRunner("bun test")).toBe(true)
  })

  // 2026-09-18: the "bun test only" carve-out (user directive 2026-09-09) is
  // RETIRED. `bun run` drives long, SILENT children (tsgo prints nothing on
  // success) — the exact class the guard exists for, and one the background-job
  // stall heartbeat auto-kills after 120s of silence.
  test("bun run/build/x/typecheck are wrapped (carve-out retired 2026-09-18)", () => {
    for (const cmd of [
      "bun typecheck",
      "bun run script.ts",
      "bun run build",
      "bun build ./x.ts",
      "bun x somepkg",
    ]) {
      const r = autoWrapCmdRunner(cmd)
      expect(r.wrapped).toBe(true)
      expect(r.command).toBe(`cmd_runner start -- ${cmd}`)
      expect(shouldRouteViaCmdRunner(cmd)).toBe(true)
    }
  })

  test("already-wrapped and cmd_runner commands pass through unchanged", () => {
    const r = autoWrapCmdRunner("cmd_runner start -- bun test x")
    expect(r.wrapped).toBe(false)
    expect(r.command).toBe("cmd_runner start -- bun test x")
    expect(shouldRouteViaCmdRunner("cmd_runner status x")).toBe(false)
  })

  test("non-crash-prone commands are untouched", () => {
    const r = autoWrapCmdRunner("git status")
    expect(r.wrapped).toBe(false)
    expect(shouldRouteViaCmdRunner("git status")).toBe(false)
  })

  test("other crash-prone binaries still wrap (cargo/clang/etc.)", () => {
    const r = autoWrapCmdRunner("cargo build --release")
    expect(r.wrapped).toBe(true)
    expect(shouldRouteViaCmdRunner("zig build")).toBe(true)
  })

  test("send payload after -- is not wrapped (wrapper already isolated)", () => {
    const r = autoWrapCmdRunner("cmd_runner send rid -- bun repl")
    expect(r.wrapped).toBe(false)
  })

  test("binary+argv auto-wrap for run tool", () => {
    const w = autoWrapBinary("bun", ["test", "foo.test.ts"])
    expect(w.wrapped).toBe(true)
    expect(w.binary).toBe("cmd_runner")
    expect(w.args).toEqual(["start", "--", "bun", "test", "foo.test.ts"])
    const runWrapped = autoWrapBinary("bun", ["run", "script.ts"])
    expect(runWrapped.wrapped).toBe(true)
    expect(runWrapped.binary).toBe("cmd_runner")
    const plain = autoWrapBinary("git", ["status"])
    expect(plain.wrapped).toBe(false)
    expect(plain.binary).toBe("git")
  })

  test("safety net: bare crash-prone command still throws", () => {
    expect(() => enforceBinaryViaCmdRunner("cargo build --release")).toThrow(/must run through cmd_runner/)
    expect(() => enforceBinaryViaCmdRunner("cmd_runner start -- cargo build")).not.toThrow()
  })

  // 2026-09-18: fail-closed. A missing wrapper used to disable the whole guard
  // silently (one WARN), so every crash-prone binary ran bare. Routing is now
  // independent of availability; the absence surfaces as a BLOCK with the reason.
  test("fail-closed: without cmd_runner the crash-prone command is BLOCKED, not run bare", () => {
    setCmdRunnerProbe(false)
    expect(autoWrapCmdRunner("cargo build --release").wrapped).toBe(false)
    expect(shouldRouteViaCmdRunner("bun test x")).toBe(true)
    expect(() => enforceBinaryViaCmdRunner("cargo build --release")).toThrow(/must run through cmd_runner/)
    expect(() => enforceBinaryViaCmdRunner("cargo build --release")).toThrow(/NOT found/)
    expect(() => enforceBinaryViaCmdRunner("cmd_runner start -- cargo build")).not.toThrow()
  })
})

// 2026-10-06 (owner directive): any executable other than the known tools
// (bin/** + git/python/node/pwsh/cmd) is crash-prone — it can crash on a bug or
// HANG, and a bare hang took the TUI and its logs with it. Unknown apps take the
// same route as the crash-prone list: cmd_runner start -- … (fail-closed).
describe("unknown-app safe launch (crash-prone inversion)", () => {
  beforeEach(() => setCmdRunnerProbe(true))
  afterEach(() => setCmdRunnerProbe(undefined))

  test("a freshly built app is wrapped even though it is not on the crash-prone list", () => {
    const r = autoWrapCmdRunner("bench_crc32_obj.exe")
    expect(r.wrapped).toBe(true)
    expect(r.command).toBe("cmd_runner start -- bench_crc32_obj.exe")
    expect(shouldRouteViaCmdRunner("D:\\proj\\bench_crc32_obj.exe --fast")).toBe(true)
    expect(shouldRouteViaCmdRunner("dcc64.exe -B -$R- bench.dpr")).toBe(true)
  })

  test("run tool: unknown binary+argv is wrapped; known binary stays bare", () => {
    const w = autoWrapBinary("D:\\proj\\bench_crc32_obj.exe", [])
    expect(w.wrapped).toBe(true)
    expect(w.binary).toBe("cmd_runner")
    expect(w.args).toEqual(["start", "--", "D:\\proj\\bench_crc32_obj.exe"])
    const known = autoWrapBinary("python", ["script.py"])
    expect(known.wrapped).toBe(false)
    expect(known.binary).toBe("python")
  })

  test("known tools stay bare", () => {
    for (const cmd of [
      "git status",
      "python x.py",
      "node x.js",
      "rg foo",
      "fossil status",
      "sqlite3 db .tables",
      "cmd /c ver",
    ]) {
      expect(shouldRouteViaCmdRunner(cmd)).toBe(false)
    }
  })

  test("shell builtins stay bare (no false wraps)", () => {
    for (const cmd of ["cd repo", "echo hi", "set X=1", "dir /b", "cd repo && echo done"]) {
      expect(shouldRouteViaCmdRunner(cmd)).toBe(false)
    }
  })

  // A bare command word is not an executable FILE: it keeps the old permission
  // flow (bash.test.ts «asks for the permission of the shell it actually runs»).
  test("bare command words are not app files", () => {
    for (const cmd of ["mytool --flag", "ping -n 2 127.0.0.1", "Get-Date foo", "nonexistent_cmd_xyz"]) {
      expect(shouldRouteViaCmdRunner(cmd)).toBe(false)
    }
  })

  test("quoted executable paths are one token", () => {
    expect(shouldRouteViaCmdRunner('"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command "x"')).toBe(false)
    expect(shouldRouteViaCmdRunner('"C:\\Tools\\myapp.exe" -x')).toBe(true)
  })

  // Paths to the KNOWN crash-prone runners keep the old unwrapped behaviour —
  // only BARE forms are routed (the truncation suite depends on this).
  test("paths to crash-prone runners keep the old unwrapped behaviour", () => {
    expect(shouldRouteViaCmdRunner('C:/host/bun.exe -e "1"')).toBe(false)
    expect(shouldRouteViaCmdRunner("bun test x")).toBe(true)
  })

  test("an unknown app inside a chain routes the whole command", () => {
    expect(shouldRouteViaCmdRunner("git status && bench_crc32_obj.exe")).toBe(true)
    expect(shouldRouteViaCmdRunner("echo start | mytool.exe --run")).toBe(true)
  })

  test("fail-closed: unknown app without cmd_runner is BLOCKED, not run bare", () => {
    setCmdRunnerProbe(false)
    expect(autoWrapCmdRunner("bench_crc32_obj.exe").wrapped).toBe(false)
    expect(() => enforceBinaryViaCmdRunner("bench_crc32_obj.exe")).toThrow(/must run through cmd_runner/)
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
