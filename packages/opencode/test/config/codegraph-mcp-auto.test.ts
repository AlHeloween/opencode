import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "path"
import {
  defaultCodegraphMcpConfig,
  injectAutoCodegraphMcp,
  isCodegraphMcpOptOut,
  resolveCodegraphBin,
  shouldAutoEnableCodegraphMcp,
} from "../../src/config/codegraph-mcp-auto"

// Requirement (plan robot-installer, after B4 «Open for the installer», 2026-10-07): codegraph ships BESIDE
// opencode.exe (`<install>/codegraph.cmd` + `codegraph/`) and is not on a client's PATH. Bootstrap, the auto-inject
// gate and the MCP command must answer from ONE resolver, and the MCP command must be that absolute path — a bare
// `codegraph` resolves through PATH only, so the index got created and the MCP failed to start (measured on candidate
// 10.0.1219: `experiments_history/2026-10-07_codegraph-resolver/`).

const SHIM = process.platform === "win32" ? "codegraph.cmd" : "codegraph"
const NO_PATH = { PATH: "", PATHEXT: ".EXE;.CMD" } // no PATH: only the robot's own location may answer

async function layout() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cg-resolve-"))
  const exeDir = path.join(root, "install")
  const onPath = path.join(root, "path-dir")
  const project = path.join(root, "client-project")
  await Promise.all([exeDir, onPath, project].map((d) => mkdir(d, { recursive: true })))
  return { root, exeDir, onPath, project }
}

async function touch(file: string) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, "@echo off\n")
}

async function withLayout(fn: (t: Awaited<ReturnType<typeof layout>>) => Promise<void> | void) {
  const t = await layout()
  try {
    await fn(t)
  } finally {
    await rm(t.root, { recursive: true, force: true })
  }
}

describe("resolveCodegraphBin — one resolver for bootstrap, auto-inject and the MCP command", () => {
  test("shipped beside the exe and not on PATH: the sibling's absolute path", () =>
    withLayout(async (t) => {
      await touch(path.join(t.exeDir, SHIM))
      expect(resolveCodegraphBin(NO_PATH, t.exeDir)).toBe(path.join(t.exeDir, SHIM))
    }))

  test("nothing beside the exe: PATH answers", () =>
    withLayout(async (t) => {
      await touch(path.join(t.onPath, SHIM))
      const got = resolveCodegraphBin({ ...NO_PATH, PATH: t.onPath }, t.exeDir)
      expect(got?.toLowerCase()).toBe(path.join(t.onPath, SHIM).toLowerCase())
    }))

  test("the robot's own copy wins over another codegraph on PATH", () =>
    withLayout(async (t) => {
      await touch(path.join(t.exeDir, SHIM))
      await touch(path.join(t.onPath, SHIM))
      expect(resolveCodegraphBin({ ...NO_PATH, PATH: t.onPath }, t.exeDir)).toBe(path.join(t.exeDir, SHIM))
    }))

  test("found nowhere: null", () =>
    withLayout((t) => {
      expect(resolveCodegraphBin(NO_PATH, t.exeDir)).toBeNull()
    }))
})

describe("codegraph-mcp-auto", () => {
  test("opt-out via env", () => {
    expect(isCodegraphMcpOptOut({ OPENCODE_CODEGRAPH_MCP: "0" })).toBe(true)
    expect(isCodegraphMcpOptOut({ OPENCODE_CODEGRAPH_MCP: "false" })).toBe(true)
    expect(isCodegraphMcpOptOut({})).toBe(false)
  })

  test("auto-enables when .codegraph exists, with no binary anywhere", () =>
    withLayout(async (t) => {
      await mkdir(path.join(t.project, ".codegraph"))
      expect(shouldAutoEnableCodegraphMcp(t.project, NO_PATH, t.exeDir)).toBe(true)
    }))

  test("MCP command is the resolved absolute path, not a PATH lookup", () =>
    withLayout(async (t) => {
      await touch(path.join(t.exeDir, SHIM))
      const d = defaultCodegraphMcpConfig(NO_PATH, t.exeDir)
      expect(d.type).toBe("local")
      if (d.type !== "local") throw new Error("expected a local MCP config")
      expect(d.command).toEqual([path.join(t.exeDir, SHIM), "serve", "--mcp"])
      expect(d.environment?.CODEGRAPH_MCP_TOOLS).toContain("explore")
    }))

  test("fresh client project, codegraph only beside the exe: injected with the absolute command", () =>
    withLayout(async (t) => {
      await touch(path.join(t.exeDir, SHIM))
      const { mcp, injected } = injectAutoCodegraphMcp({}, t.project, NO_PATH, t.exeDir)
      expect(injected).toBe(true)
      const cg = mcp.codegraph as { type: string; command: string[]; enabled?: boolean; timeout?: number }
      expect(cg.type).toBe("local")
      expect(cg.command).toEqual([path.join(t.exeDir, SHIM), "serve", "--mcp"])
      expect(cg.enabled).toBe(true)
      expect(cg.timeout).toBe(120_000)
    }))

  test("index present, binary nowhere: injected with the bare name, so the spawn error names the tool", () =>
    withLayout(async (t) => {
      await mkdir(path.join(t.project, ".codegraph"))
      const { mcp, injected } = injectAutoCodegraphMcp({}, t.project, NO_PATH, t.exeDir)
      expect(injected).toBe(true)
      expect((mcp.codegraph as { command: string[] }).command).toEqual(["codegraph", "serve", "--mcp"])
    }))

  test("no index, binary nowhere: not injected", () =>
    withLayout((t) => {
      expect(injectAutoCodegraphMcp({}, t.project, NO_PATH, t.exeDir).injected).toBe(false)
    }))

  test("does not override existing mcp.codegraph", () =>
    withLayout(async (t) => {
      await mkdir(path.join(t.project, ".codegraph"))
      const existing = {
        type: "local" as const,
        command: ["custom-cg", "serve", "--mcp"],
        enabled: true,
      }
      const { mcp, injected } = injectAutoCodegraphMcp({ codegraph: existing }, t.project, NO_PATH, t.exeDir)
      expect(injected).toBe(false)
      expect(mcp.codegraph).toEqual(existing)
    }))

  test("respects enabled:false disable", () =>
    withLayout(async (t) => {
      await mkdir(path.join(t.project, ".codegraph"))
      const { mcp, injected } = injectAutoCodegraphMcp({ codegraph: { enabled: false } }, t.project, NO_PATH, t.exeDir)
      expect(injected).toBe(false)
      expect(mcp.codegraph).toEqual({ enabled: false })
    }))

  test("opt-out skips inject even with index and a binary beside the exe", () =>
    withLayout(async (t) => {
      await mkdir(path.join(t.project, ".codegraph"))
      await touch(path.join(t.exeDir, SHIM))
      const { injected } = injectAutoCodegraphMcp({}, t.project, { ...NO_PATH, OPENCODE_CODEGRAPH_MCP: "0" }, t.exeDir)
      expect(injected).toBe(false)
    }))
})
