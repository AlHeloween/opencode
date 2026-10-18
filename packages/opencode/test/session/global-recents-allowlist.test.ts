/**
 * t87 RED — the global recents list constrains every layer (plan
 * `plans/2026-10-18_global-recents-constraint.md`).
 *
 * The global list is the ordered allowlist hosted on the global config layer
 * (L4); `opts.globalRecents` below is its test double — the planned t87
 * plumbing, already accepted (and runtime-ignored) by today's signature via
 * the options bag. Each test fails on today's code FOR THE STATED REASON:
 * the resolver returns the stale layer value instead of gating it.
 *
 * Guard T4 passes today and pins the order the fix must preserve.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { mkdir, writeFile } from "fs/promises"
import { mkdirSync } from "fs"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"
import {
  loadSessionSettings,
  readModelState,
  resolveAgentModel,
  saveSessionSettings,
  sessionAgentModel,
  workspaceAgentModel,
} from "../../src/session/session-settings"

/** Point Global.Path.data at the temp worktree, run fn, restore. */
async function withDataDir(tmp: { path: string }, fn: () => Promise<void>) {
  const prev = Global.Path.home
  try {
    mkdirSync(path.join(tmp.path, ".opencode", "data", "log"), { recursive: true })
    Global.initFromWorktree(tmp.path)
    await Log.init()
    await fn()
  } finally {
    Global.initFromWorktree(prev)
  }
}

/** Write the worktree layer file the way `local.tsx` save() does. */
async function writeModelState(state: Record<string, unknown>) {
  const file = path.join(Global.Path.state, "model.json")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state))
}

const WS = "wrk_recents"
/** The ordered allowlist (free zen -> contributor via Go); the stale ADID pick is absent. */
const GLOBAL_RECENTS = ["opencode/muse-spark-1.3-contributor-free", "opencode-go/muse-spark-1.3-contributor"]
const STALE = "opencode-go/glm-5.3-flash"
const IN_LIST_WORKTREE = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" }

describe("t87 — a worktree pick absent from global recents does not run", () => {
  test("resolveAgentModel falls to global instead of returning the stale worktree value", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      // The ADID incident shape: the worktree layer names a model the global list dropped.
      await writeModelState({ workspaceAgent: { [WS]: { build_mode: { providerID: "opencode-go", modelID: "glm-5.3-flash" } } } })
      const state = await readModelState()
      expect(workspaceAgentModel("build_mode", WS, state)).toEqual({ providerID: "opencode-go", modelID: "glm-5.3-flash" })

      const resolved = await resolveAgentModel(
        "build_mode",
        { sessionID: "ses_t87_none", workspaceID: WS },
        // Planned t87 plumbing: the allowlist rides the options bag (ignored by today's code).
        { globalRecents: GLOBAL_RECENTS } as any,
      )
      // Gated: the stale value is refused, the caller falls to the global list.
      expect(resolved).toBeUndefined()
    })
  })
})

describe("t87 — a session override outside the list is refused the same way", () => {
  test("resolveAgentModel falls through the stale session value to the in-list worktree value", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      const sid = "ses_t87_stale"
      await writeModelState({ workspaceAgent: { [WS]: { build_mode: IN_LIST_WORKTREE } } })
      await saveSessionSettings(sid, { agent: { build_mode: { model: STALE } } })
      expect(sessionAgentModel("build_mode", await loadSessionSettings(sid))).toEqual({
        providerID: "opencode-go",
        modelID: "glm-5.3-flash",
      })

      const resolved = await resolveAgentModel(
        "build_mode",
        { sessionID: sid, workspaceID: WS },
        { globalRecents: GLOBAL_RECENTS } as any,
      )
      // The session layer is refused; the in-list worktree value below it answers.
      expect(resolved).toEqual(IN_LIST_WORKTREE)
    })
  })
})

describe("t87 — structural: the resolver source carries the gate", () => {
  test("resolveAgentModel checks one global key and warns on refusal", () => {
    const SRC = fs
      .readFileSync(path.join(import.meta.dir, "../../src/session/session-settings.ts"), "utf8")
      .replace(/\r\n/g, "\n")
    const start = SRC.indexOf("export async function resolveAgentModel(")
    expect(start).toBeGreaterThan(-1)
    // Slice to the next export — the body holds indented blocks, so the first
    // col-0 `}` is no longer a reliable end after the opts bag grew.
    const end = SRC.indexOf("export function resolveChainAgentModel(", start)
    expect(end).toBeGreaterThan(start)
    const body = SRC.slice(start, end)
    // ONE lookup of ONE key (the L4 list) as a validity check — not a parent walk.
    expect(body).toContain("globalRecents")
    // The refusal itself is warned at the gate helper — one shared site for every
    // layer, so the resolver only needs to CALL it (observable, never silent).
    const GATE = fs
      .readFileSync(path.join(import.meta.dir, "../../src/session/global-recents.ts"), "utf8")
      .replace(/\r\n/g, "\n")
    expect(body).toContain("gateLayerModel")
    expect(GATE).toContain("not in global recents")
  })
})

describe("t87 guard — an in-list worktree pick still wins over the global default", () => {
  test("order kept: session absent, worktree in-list answers (passes today, must stay green)", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      await writeModelState({ workspaceAgent: { [WS]: { build_mode: IN_LIST_WORKTREE } } })
      const resolved = await resolveAgentModel(
        "build_mode",
        { sessionID: "ses_t87_guard", workspaceID: WS },
        { globalRecents: GLOBAL_RECENTS } as any,
      )
      expect(resolved).toEqual(IN_LIST_WORKTREE)
    })
  })
})
