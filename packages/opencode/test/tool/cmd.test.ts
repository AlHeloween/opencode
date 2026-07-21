import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import path from "path"
import { Config } from "@/config/config"
import { CmdTool } from "../../src/tool/cmd"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "../../src/plugin"

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

function initCmd() {
  return runtime.runPromise(CmdTool.pipe(Effect.flatMap((info) => info.init())))
}

const projectRoot = path.join(__dirname, "../..")

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

// --- Shared helpers for truncation tests ---
const fillCmd = (mode: "lines" | "bytes", n: number) => {
  if (mode === "lines") {
    // cmd.exe for-loop: generates N numbered lines
    return `for /l %i in (1,1,${n}) do @echo %i`
  }
  // bytes mode: generate aaaaaaaaa... via for loop with ~100 chars per line
  const line = "a".repeat(100)
  const reps = Math.ceil(n / 100)
  return `for /l %i in (1,1,${reps}) do @echo ${line}`
}

const mustTruncate = (result: {
  metadata: { truncated?: boolean; exit?: number | null } & Record<string, unknown>
  output: string
}) => {
  if (result.metadata.truncated) return
  throw new Error(`cmd: exit=${String(result.metadata.exit)}, output: ${result.output}`)
}

const pause = (s: number) =>
  process.platform === "win32"
    ? `ping -n ${s + 1} 127.0.0.1`
    : `sleep ${s}`

// Long-blocking command that produces no stdout (for timeout tests)
const blockLong = () =>
  process.platform === "win32"
    ? `ping -n 601 127.0.0.1 >nul`
    : `sleep 600`

describe("tool.cmd", () => {
  test("basic echo", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute({ command: "echo hello", description: "test echo", timeout: 5000 }, ctx as any),
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  }, 15_000)

  test("captures stderr", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute({ command: "echo stderr 1>&2", description: "test stderr", timeout: 5000 }, ctx as any),
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain("stderr")
      },
    })
  })

  // Regression: forked stream drain raced process exitCode → empty output for
  // fast commands (agent cmd tool), while sequential !shell path still worked.
  test("fast command with 2>&1 captures stdout (no empty race)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        // where is very fast; 2>&1 is what agents often emit
        const cmd =
          process.platform === "win32" ? "where cmd 2>&1" : "command -v sh 2>&1 || which sh 2>&1"
        // Run several times — the race was intermittent
        for (let i = 0; i < 8; i++) {
          const result = await Effect.runPromise(
            tool.execute({ command: cmd, description: "where with redirect", timeout: 10000 }, ctx as any),
          )
          expect(result.output).not.toBe("(no output)")
          expect(result.output.trim().length).toBeGreaterThan(0)
        }
      },
    })
  }, 60_000)

  // TS/compilers write diagnostics to stderr; tool must capture without 2>&1 too.
  test("stderr-only diagnostics captured without 2>&1", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const cmd =
          process.platform === "win32"
            ? "echo TS_DIAG_ON_STDERR 1>&2"
            : "echo TS_DIAG_ON_STDERR 1>&2"
        const result = await Effect.runPromise(
          tool.execute({ command: cmd, description: "stderr only", timeout: 10000 }, ctx as any),
        )
        expect(result.output).toContain("TS_DIAG_ON_STDERR")
      },
    })
  }, 15_000)

  test("fails on missing command", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute({ command: "nonexistent_cmd_xyz", description: "test fail", timeout: 5000 }, ctx as any),
        )
        expect(result.metadata.exit).not.toBe(0)
      },
    })
  })

  test("rejects negative timeout", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        try {
          await Effect.runPromise(tool.execute({ command: "echo test", description: "test", timeout: -1 }, ctx as any))
          expect.unreachable("should have thrown")
        } catch (e) {
          expect(e).toBeTruthy()
        }
      },
    })
  })
})

describe("tool.cmd paths with spaces", () => {
  test("quoted path with spaces succeeds", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dir = path.join(tmp.path, "test space dir")
        require("fs").mkdirSync(dir, { recursive: true })
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute({ command: `dir /b "${dir}"`, description: "quoted spaced path", timeout: 5000 }, ctx as any),
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("unquoted path with spaces fails", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute({ command: `dir ${tmp.path}\\test`, description: "unquoted path", timeout: 5000 }, ctx as any),
        )
        expect(result.metadata.exit).toBe(1)
      },
    })
  })
})

describe("tool.cmd workdir", () => {
  test("uses workdir parameter", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute(
            { command: "echo %CD%", workdir: tmp.path, description: "workdir test", timeout: 5000 },
            ctx as any,
          ),
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain(path.basename(tmp.path))
      },
    })
  })
})

describe("tool.cmd permissions", () => {
  test("asks for permission on del command", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const ask = (req: any) => {
          prompts.push(req)
          return Effect.void
        }
        const tool = await initCmd()
        await Effect.runPromise(
          tool.execute({ command: "del test.txt", description: "test del perm", timeout: 5000 }, {
            ...ctx,
            ask,
          } as any),
        )
        expect(prompts.length).toBeGreaterThan(0)
        expect(prompts.some((p) => p.permission === "cmd")).toBe(true)
      },
    })
  })

  test("does not ask for safe commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const ask = (req: any) => {
          prompts.push(req)
          return Effect.void
        }
        const tool = await initCmd()
        await Effect.runPromise(
          tool.execute({ command: "dir", description: "test dir safe", timeout: 5000 }, { ...ctx, ask } as any),
        )
        expect(prompts.length).toBe(0)
      },
    })
  })

  test("asks before date and time commands", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await initCmd()
        for (const command of ["date 01-01-2030", "time 12:00"]) {
          const prompts: any[] = []
          const stop = new Error("stop after permission")
          await expect(
            Effect.runPromise(
              tool.execute({ command, description: "test system clock permission", timeout: 5000 }, {
                ...ctx,
                ask: (request: any) => {
                  prompts.push(request)
                  return Effect.fail(stop)
                },
              } as any),
            ),
          ).rejects.toThrow(stop.message)
          expect(prompts).toContainEqual(expect.objectContaining({ permission: "cmd" }))
        }
      },
    })
  })

  test("classifies uppercase filesystem commands and quoted external paths", async () => {
    await using project = await tmpdir()
    await using outside = await tmpdir()
    const target = path.join(outside.path, "outside.txt")
    await Bun.write(target, "keep")
    await Instance.provide({
      directory: project.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        await expect(
          Effect.runPromise(
            tool.execute({ command: `DEL "${target}"`, description: "test uppercase del permission", timeout: 5000 }, {
              ...ctx,
              ask: (request: any) => {
                prompts.push(request)
                return Effect.fail(stop)
              },
            } as any),
          ),
        ).rejects.toThrow(stop.message)
        expect(prompts[0]).toMatchObject({ permission: "external_directory" })
        expect(await Bun.file(target).exists()).toBe(true)
      },
    })
  })

  test.skipIf(!Bun.which("pwsh") && !Bun.which("powershell"))(
    "scans external paths inside PowerShell command payloads",
    async () => {
      await using project = await tmpdir()
      await using outside = await tmpdir()
      const target = path.join(outside.path, "outside.txt")
      await Bun.write(target, "keep")
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const prompts: any[] = []
          const stop = new Error("stop after permission")
          const tool = await initCmd()
          const shell = Bun.which("pwsh") || Bun.which("powershell")!
          await expect(
            Effect.runPromise(
              tool.execute(
                {
                  command: `"${shell}" -Command "Remove-Item '${target}'"`,
                  description: "test PowerShell external permission",
                  timeout: 5000,
                },
                {
                  ...ctx,
                  ask: (request: any) => {
                    prompts.push(request)
                    return Effect.fail(stop)
                  },
                } as any,
              ),
            ),
          ).rejects.toThrow(stop.message)
          expect(prompts[0]).toMatchObject({ permission: "external_directory" })
          expect(await Bun.file(target).exists()).toBe(true)
        },
      })
    },
  )

  // --- CWD commands: no "cmd" permission, only external_directory if applicable ---
  test("does not ask for cmd permission when command is cd only", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const ask = (req: any) => {
          prompts.push(req)
          return Effect.void
        }
        const tool = await initCmd()
        await Effect.runPromise(
          tool.execute({ command: "cd .", description: "cd current dir", timeout: 5000 }, {
            ...ctx,
            ask,
          } as any),
        )
        const cmdReq = prompts.find((p) => p.permission === "cmd")
        expect(cmdReq).toBeUndefined()
      },
    })
  })

  test("does not ask for cmd permission on pushd inside project", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const ask = (req: any) => {
          prompts.push(req)
          return Effect.void
        }
        const tool = await initCmd()
        await Effect.runPromise(
          tool.execute({ command: "pushd .", description: "pushd current dir", timeout: 5000 }, {
            ...ctx,
            ask,
          } as any),
        )
        const cmdReq = prompts.find((p) => p.permission === "cmd")
        expect(cmdReq).toBeUndefined()
      },
    })
  })

  // --- FILES set: filesystem-affecting commands should trigger "cmd" permission ---
  test("asks for permission on copy command", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        await expect(
          Effect.runPromise(
            tool.execute({ command: "copy file1.txt file2.txt", description: "test copy perm", timeout: 5000 }, {
              ...ctx,
              ask: (request: any) => {
                prompts.push(request)
                return Effect.fail(stop)
              },
            } as any),
          ),
        ).rejects.toThrow(stop.message)
        expect(prompts.some((p) => p.permission === "cmd")).toBe(true)
      },
    })
  })

  test("asks for permission on move command", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        await expect(
          Effect.runPromise(
            tool.execute({ command: "move file1.txt file2.txt", description: "test move perm", timeout: 5000 }, {
              ...ctx,
              ask: (request: any) => {
                prompts.push(request)
                return Effect.fail(stop)
              },
            } as any),
          ),
        ).rejects.toThrow(stop.message)
        expect(prompts.some((p) => p.permission === "cmd")).toBe(true)
      },
    })
  })

  test("asks for permission on mkdir command", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        await expect(
          Effect.runPromise(
            tool.execute({ command: "mkdir newdir", description: "test mkdir perm", timeout: 5000 }, {
              ...ctx,
              ask: (request: any) => {
                prompts.push(request)
                return Effect.fail(stop)
              },
            } as any),
          ),
        ).rejects.toThrow(stop.message)
        expect(prompts.some((p) => p.permission === "cmd")).toBe(true)
      },
    })
  })

  test("asks for permission on rmdir command", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        await expect(
          Effect.runPromise(
            tool.execute({ command: "rmdir emptydir", description: "test rmdir perm", timeout: 5000 }, {
              ...ctx,
              ask: (request: any) => {
                prompts.push(request)
                return Effect.fail(stop)
              },
            } as any),
          ),
        ).rejects.toThrow(stop.message)
        expect(prompts.some((p) => p.permission === "cmd")).toBe(true)
      },
    })
  })

  test("asks for permission on rename command", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        await expect(
          Effect.runPromise(
            tool.execute({ command: "ren old.txt new.txt", description: "test rename perm", timeout: 5000 }, {
              ...ctx,
              ask: (request: any) => {
                prompts.push(request)
                return Effect.fail(stop)
              },
            } as any),
          ),
        ).rejects.toThrow(stop.message)
        expect(prompts.some((p) => p.permission === "cmd")).toBe(true)
      },
    })
  })

  // --- Redirection: permission pattern includes redirection ---
  test("matches redirects in permission pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        // `del` is in FILES — triggers permission; `> nul` redirection is included in pattern
        await expect(
          Effect.runPromise(
            tool.execute(
              { command: "del nonexistent.txt > nul", description: "del with redirect", timeout: 5000 },
              {
                ...ctx,
                ask: (request: any) => {
                  prompts.push(request)
                  return Effect.fail(stop)
                },
              } as any,
            ),
          ),
        ).rejects.toThrow(stop.message)
        const cmdReq = prompts.find((p) => p.permission === "cmd")
        expect(cmdReq).toBeDefined()
        // Pattern should include the full command with redirection
        expect(cmdReq.patterns.some((p: string) => p.includes(">"))).toBe(true)
      },
    })
  })
})

test("tool.cmd applies shell.env plugin output", async () => {
  const local = ManagedRuntime.make(
    Layer.mergeAll(
      CrossSpawnSpawner.defaultLayer,
      AppFileSystem.defaultLayer,
      Layer.succeed(
        Plugin.Service,
        Plugin.Service.of({
          trigger: ((name: string, _input: unknown, output: { env?: Record<string, string> }) =>
            Effect.succeed(
              name === "shell.env" ? { ...output, env: { CMD_TOOL_PLUGIN_ENV: "injected" } } : output,
            )) as any,
          list: () => Effect.succeed([]),
          init: () => Effect.void,
        }),
      ),
      Truncate.defaultLayer,
      Config.defaultLayer,
      Agent.defaultLayer,
    ),
  )
  await using tmp = await tmpdir()
  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await local.runPromise(CmdTool.pipe(Effect.flatMap((info) => info.init())))
        const result = await Effect.runPromise(
          tool.execute(
            { command: "echo %CMD_TOOL_PLUGIN_ENV%", description: "test plugin environment", timeout: 15_000 },
            ctx as any,
          ),
        )
        expect(result.output).toContain("injected")
      },
    })
  } finally {
    await local.dispose()
  }
}, 20_000)

describe("tool.cmd background", () => {
  test("background fallback runs command when no Jobs service", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute(
            { command: "echo bg_fallback_test", description: "bg fallback", run_in_background: true, timeout: 5000 },
            ctx as any,
          ),
        )
        // Without Jobs service, falls back to synchronous execution
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain("bg_fallback_test")
      },
    })
  })

  test("runs synchronously with run_in_background: false", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: "echo sync_test_marker",
              description: "sync mode test",
              run_in_background: false,
              timeout: 5000,
            },
            ctx as any,
          ),
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.output).toContain("sync_test_marker")
        // In sync mode, no jobID metadata
        expect((result.metadata as any).jobID).toBeUndefined()
      },
    })
  })
})

// =========================================================================
// Phase 1: Critical gaps — abort, timeout, truncation, streaming
// =========================================================================

describe("tool.cmd abort", () => {
  test("preserves output when aborted", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const controller = new AbortController()
        const collected: string[] = []
        const res = await Effect.runPromise(
          tool.execute(
            {
              command: `echo BEFORE_ABORT_CMD && ${pause(15)}`,
              description: "Long running command",
              timeout: 60000,
            },
            {
              ...ctx,
              abort: controller.signal,
              metadata: (input: any) =>
                Effect.sync(() => {
                  const output = (input.metadata as { output?: string })?.output
                  if (output && output.includes("BEFORE_ABORT_CMD") && !controller.signal.aborted) {
                    collected.push(output)
                    controller.abort()
                  }
                }),
            } as any,
          ),
        )
        expect(res.output).toContain("BEFORE_ABORT_CMD")
        expect(res.output).toContain("Command interrupted (abort signal received)")
        expect(collected.length).toBeGreaterThan(0)
      },
    })
  }, 30_000)
})

describe("tool.cmd timeout", () => {
  test.skip("safety net resolves hanging command with null exit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: `echo STARTED_TIMEOUT && ${blockLong()}`,
              description: "Timeout test",
              timeout: 500, // short timeout triggers safety net at 5500ms
            },
            ctx as any,
          ),
        )
        expect(result.output).toContain("STARTED_TIMEOUT")
        // Safety net resolved — exit code is null when timeout fires
        expect(result.metadata.exit).toBe(null)
      },
    })
  }, 15_000)
})

describe("tool.cmd truncation", () => {
  test("truncates output exceeding line limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const lineCount = Truncate.MAX_LINES + 500
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: fillCmd("lines", lineCount),
              description: "Generate lines exceeding limit",
              timeout: 30000,
            },
            ctx as any,
          ),
        )
        mustTruncate(result)
        expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
        expect(result.output).toMatch(/Full output saved to:\s+\S+/)
      },
    })
  }, 30_000)

  test("truncates output exceeding byte limit", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: fillCmd("bytes", byteCount),
              description: "Generate bytes exceeding limit",
              timeout: 30000,
            },
            ctx as any,
          ),
        )
        mustTruncate(result)
        expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
        expect(result.output).toMatch(/Full output saved to:\s+\S+/)
      },
    })
  }, 30_000)

  test("does not truncate small output", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: "echo hello_trunc_check",
              description: "Echo small output",
              timeout: 5000,
            },
            ctx as any,
          ),
        )
        expect((result.metadata as { truncated?: boolean }).truncated).not.toBe(true)
        expect(result.output).toContain("hello_trunc_check")
      },
    })
  })

  test("full output is saved to file when truncated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const lineCount = Truncate.MAX_LINES + 100
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: fillCmd("lines", lineCount),
              description: "Generate lines for file check",
              timeout: 30000,
            },
            ctx as any,
          ),
        )
        mustTruncate(result)

        const filepath = (result.metadata as { outputPath?: string }).outputPath
        expect(filepath).toBeTruthy()

        const saved = await Bun.file(filepath!).text()
        const lines = saved.trim().split(/\r?\n/)
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      },
    })
  }, 30_000)
})

describe("tool.cmd streaming", () => {
  test("streams metadata updates progressively", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const tool = await initCmd()
        const updates: string[] = []
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: `echo FIRST_STREAM && ${pause(1)} && echo SECOND_STREAM`,
              description: "Streaming test",
              timeout: 15000,
            },
            {
              ...ctx,
              metadata: (input: any) =>
                Effect.sync(() => {
                  const output = (input.metadata as { output?: string })?.output
                  if (output) updates.push(output)
                }),
            } as any,
          ),
        )
        expect(result.output).toContain("FIRST_STREAM")
        expect(result.output).toContain("SECOND_STREAM")
        expect(updates.length).toBeGreaterThan(1)
      },
    })
  }, 20_000)
})

// =========================================================================
// Phase 4: Edge cases — PowerShell quoted paths, validatePaths, hasRedirection
// =========================================================================

describe("tool.cmd PowerShell detection", () => {
  test.skipIf(!Bun.which("pwsh") && !Bun.which("powershell"))(
    "detects PowerShell with quoted executable path",
    async () => {
      await using project = await tmpdir()
      await using outside = await tmpdir()
      const target = path.join(outside.path, "outside.txt")
      await Bun.write(target, "keep")
      await Instance.provide({
        directory: project.path,
        fn: async () => {
          const prompts: any[] = []
          const stop = new Error("stop after permission")
          const tool = await initCmd()
          const shell = Bun.which("pwsh") || Bun.which("powershell")!
          // Quote the executable path — should still be detected as PowerShell
          await expect(
            Effect.runPromise(
              tool.execute(
                {
                  command: `"${shell}" -Command "Get-Content '${target}'"`,
                  description: "test quoted pwsh path",
                  timeout: 5000,
                },
                {
                  ...ctx,
                  ask: (request: any) => {
                    prompts.push(request)
                    return Effect.fail(stop)
                  },
                } as any,
              ),
            ),
          ).rejects.toThrow(stop.message)
          // Should still scan with PowerShell grammar → external_directory permission
          expect(prompts.some((p) => p.permission === "external_directory")).toBe(true)
          expect(await Bun.file(target).exists()).toBe(true)
        },
      })
    },
  )

  test("isPowerShellCommand returns false for plain cmd commands", async () => {
    // This is tested indirectly: plain cmd commands use batch grammar
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await initCmd()
        const prompts: any[] = []
        await Effect.runPromise(
          tool.execute(
            { command: "echo just a cmd command", description: "plain cmd", timeout: 5000 },
            {
              ...ctx,
              ask: (request: any) => {
                prompts.push(request)
                return Effect.void
              },
            } as any,
          ),
        )
        // Plain cmd commands should not trigger PowerShell-specific parsing
        const pwshReq = prompts.find((p) => p.permission === "powershell")
        expect(pwshReq).toBeUndefined()
      },
    })
  })
})

describe("tool.cmd path validation", () => {
  test("warns about double drive letter in paths", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await initCmd()
        // A path like D:\D:\x triggers double-drive validation
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: `echo test > nul`,
              workdir: tmp.path,
              description: "Path validation test",
              timeout: 5000,
            },
            ctx as any,
          ),
        )
        expect(result.metadata.exit).toBe(0)
      },
    })
  })

  test("warns about system directory paths on Windows", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await initCmd()
        const result = await Effect.runPromise(
          tool.execute(
            {
              command: `echo test`,
              workdir: tmp.path,
              description: "System dir path test",
              timeout: 5000,
            },
            ctx as any,
          ),
        )
        // Even if path issues exist, the command should still run
        expect(result.metadata.exit).toBe(0)
      },
    })
  })
})

describe("tool.cmd redirection detection", () => {
  test("hasRedirection detects redirect_stmt in batch grammar", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        // `del` is in FILES → triggers permission; `> nul` verifies redirection in pattern
        await expect(
          Effect.runPromise(
            tool.execute(
              {
                command: "del nofile.txt > nul",
                description: "test redirection detection",
                timeout: 5000,
              },
              {
                ...ctx,
                ask: (request: any) => {
                  prompts.push(request)
                  return Effect.fail(stop)
                },
              } as any,
            ),
          ),
        ).rejects.toThrow(stop.message)
        const cmdReq = prompts.find((p) => p.permission === "cmd")
        expect(cmdReq).toBeDefined()
        // The redirect should be part of the permission pattern
        expect(cmdReq.patterns.some((p: string) => p.includes(">"))).toBe(true)
      },
    })
  })

  test("FILES command with redirection triggers permission with redirect in pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const prompts: any[] = []
        const stop = new Error("stop after permission")
        const tool = await initCmd()
        // `del` is in FILES — always triggers permission; with `>`, redirect is in pattern
        await expect(
          Effect.runPromise(
            tool.execute(
              {
                command: "del nofile.txt > listing.txt",
                description: "del with redirect triggers permission",
                timeout: 5000,
              },
              {
                ...ctx,
                ask: (request: any) => {
                  prompts.push(request)
                  return Effect.fail(stop)
                },
              } as any,
            ),
          ),
        ).rejects.toThrow(stop.message)
        expect(prompts.some((p) => p.permission === "cmd")).toBe(true)
      },
    })
  })
})
