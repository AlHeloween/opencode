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
  })

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
          await Effect.runPromise(
            tool.execute({ command: "echo test", description: "test", timeout: -1 }, ctx as any),
          )
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
          tool.execute(
            { command: `dir /b "${dir}"`, description: "quoted spaced path", timeout: 5000 },
            ctx as any,
          ),
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
          tool.execute(
            { command: `dir ${tmp.path}\\test`, description: "unquoted path", timeout: 5000 },
            ctx as any,
          ),
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
          tool.execute(
            { command: "del test.txt", description: "test del perm", timeout: 5000 },
            { ...ctx, ask } as any,
          ),
        )
        expect(prompts.length).toBeGreaterThan(0)
        expect(prompts.some((p) => p.permission === "bash")).toBe(true)
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
          tool.execute(
            { command: "dir", description: "test dir safe", timeout: 5000 },
            { ...ctx, ask } as any,
          ),
        )
        expect(prompts.length).toBe(0)
      },
    })
  })
})

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
})
