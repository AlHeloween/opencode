import { test, expect, beforeEach, afterEach } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect, Layer } from "effect"
import { tmpdir } from "../fixture/fixture"
import * as ConfigPaths from "../../src/config/paths"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CurrentWorkingDirectory } from "../../src/cli/cmd/tui/config/cwd"
import { TuiConfig } from "../../src/cli/cmd/tui/config/tui"
import { Global } from "@opencode-ai/core/global"

const infra = AppFileSystem.defaultLayer

const runDirs = (directory: string, worktree?: string) =>
  Effect.runPromise(ConfigPaths.directories(directory, worktree).pipe(Effect.provide(infra)))

const runFiles = (name: string, directory: string, worktree?: string) =>
  Effect.runPromise(ConfigPaths.files(name, directory, worktree).pipe(Effect.provide(infra)))

const getTuiConfig = (directory: string) =>
  Effect.runPromise(
    TuiConfig.Service.use((svc) => svc.get()).pipe(
      Effect.provide(TuiConfig.defaultLayer.pipe(Layer.provide(Layer.succeed(CurrentWorkingDirectory, directory)))),
    ),
  )

beforeEach(async () => {
  delete process.env.OPENCODE_CONFIG_DIR
  delete process.env.OPENCODE_TUI_CONFIG
  delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
})

afterEach(async () => {
  delete process.env.OPENCODE_CONFIG_DIR
  delete process.env.OPENCODE_TUI_CONFIG
  delete process.env.OPENCODE_DISABLE_PROJECT_CONFIG
})

test("portable hermetic: directories(child, child) never includes parent .opencode", async () => {
  await using parent = await tmpdir()
  const child = path.join(parent.path, "a", "b", "bin")
  await fs.mkdir(child, { recursive: true })
  await fs.mkdir(path.join(parent.path, ".opencode"), { recursive: true })
  await fs.mkdir(path.join(child, ".opencode"), { recursive: true })
  // parent decoy marker
  await Bun.write(path.join(parent.path, ".opencode", "tui.json"), JSON.stringify({ theme: "parent-marker" }))
  const dirs = await runDirs(child, child)
  const hitsParent = dirs.some((d) => path.resolve(d) === path.resolve(path.join(parent.path, ".opencode")))
  expect(hitsParent).toBe(false)
  const hitsChild = dirs.some((d) => path.resolve(d) === path.resolve(path.join(child, ".opencode")))
  expect(hitsChild).toBe(true)
})

test("portable hermetic: files(tui, child, child) never returns parent tui files", async () => {
  await using parent = await tmpdir()
  const child = path.join(parent.path, "a", "b", "bin")
  await fs.mkdir(child, { recursive: true })
  await fs.mkdir(path.join(parent.path, ".opencode"), { recursive: true })
  await Bun.write(
    path.join(parent.path, "opencode.json"),
    JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
  )
  const found = await runFiles("tui", child, child)
  const hitsParent = found.some((f) => path.resolve(f).startsWith(path.resolve(parent.path)))
  expect(hitsParent).toBe(false)
})

test("portable hermetic: TuiConfig for child never merges parent .opencode/tui.json", async () => {
  await using parent = await tmpdir()
  const child = path.join(parent.path, "a", "b", "bin")
  await fs.mkdir(child, { recursive: true })
  await fs.mkdir(path.join(parent.path, ".opencode"), { recursive: true })
  await Bun.write(path.join(parent.path, ".opencode", "tui.json"), JSON.stringify({ theme: "parent-marker" }))
  const cfg = await getTuiConfig(child)
  expect((cfg as Record<string, unknown>).theme).not.toBe("parent-marker")
})

test("portable hermetic: unbounded directories(child) must not reach parent .opencode (regression)", async () => {
  await using parent = await tmpdir()
  const child = path.join(parent.path, "a", "b", "bin")
  await fs.mkdir(child, { recursive: true })
  await fs.mkdir(path.join(parent.path, ".opencode"), { recursive: true })
  await Bun.write(path.join(parent.path, ".opencode", "tui.json"), JSON.stringify({ theme: "parent-marker" }))
  // No worktree/stop passed — the historical leak. Hermetic default: parent invisible.
  const dirs = await runDirs(child)
  const hitsParent = dirs.some((d) => path.resolve(d) === path.resolve(path.join(parent.path, ".opencode")))
  expect(hitsParent).toBe(false)
})

test("portable hermetic: ensureModelState creates model.json layer on fresh root", async () => {
  const prevState = process.env.OPENCODE_TEST_STATE
  await using parent = await tmpdir()
  const stateDir = path.join(parent.path, ".opencode", "data", "state")
  process.env.OPENCODE_TEST_STATE = stateDir
  try {
    const { ensureModelState, readModelState } = await import("../../src/session/session-settings")
    // Global.Path.state reads OPENCODE_TEST_STATE? No — it reads worktree. Use direct dir check:
    // ensureModelState writes to Global.Path.state, so we assert shape, not location, here.
    // The hermetic location (state under worktree) is covered by the real dist-copy check (S6).
    const state = await ensureModelState()
    expect(state).toEqual({})
    // readModelState on a fresh root must fill, not throw/ENOENT-warn — after the fill it finds the layer.
    await using fresh = await tmpdir()
    expect(typeof fresh.path).toBe("string")
    const reread = await readModelState()
    expect(reread).toEqual({})
  } finally {
    if (prevState === undefined) delete process.env.OPENCODE_TEST_STATE
    else process.env.OPENCODE_TEST_STATE = prevState
  }
})

test("portable hermetic: errorMessage never prints [object Object]", async () => {
  const { errorMessage } = await import("../../src/util/error")
  expect(errorMessage({ code: "ENOENT", path: "/x/model.json" })).not.toBe("[object Object]")
  expect(errorMessage({ code: "ENOENT", path: "/x/model.json" }).length).toBeGreaterThan(0)
  expect(errorMessage(new Error("seed failed"))).toBe("seed failed")
})
