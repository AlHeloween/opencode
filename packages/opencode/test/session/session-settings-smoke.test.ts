/**
 * T5 acceptance smokes S1 and S4, plus the T4 rule — written as tests.
 *
 * Plan: `2026-09-26_unified-settings-layers.md` § T5 («Каждый — read-back файла, не typecheck»):
 *   S1 — a worktree with NO settings is filled from global;
 *   S4 — copy, not link: a worktree change never flows into the session.
 * § T4 (refined): every server fallback that resolves below the session layer records the miss
 * (`prompt.ts`), so «параметры берутся только из session» stays observable — never silent.
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
  type ModelRef,
} from "../../src/session/session-settings"
import { fillSessionAgents, fillWorkspaceAgents, unfilledWorkspaceAgents } from "../../src/session/fill-layers"

// ── Helpers (same shape as session-settings-persist.test.ts) ──

/** Point Global.Path.data at the temp worktree, run fn, restore. */
async function withDataDir(tmp: { path: string }, fn: () => Promise<void>) {
  const prev = Global.Path.home
  try {
    // The log dir must exist BEFORE initFromWorktree — Log.Default writes to data/log.
    mkdirSync(path.join(tmp.path, ".opencode", "data", "log"), { recursive: true })
    Global.initFromWorktree(tmp.path)
    await Log.init()
    await fn()
  } finally {
    Global.initFromWorktree(prev)
  }
}

/** Write the worktree layer file the way `local.tsx` save() does — plain JSON at state/model.json. */
async function writeModelState(state: Record<string, unknown>) {
  const file = path.join(Global.Path.state, "model.json")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state))
}

const AGENTS = ["build_mode", "plan_mode", "coder_agent"]
const WS = "wrk_smoke"
/** The global layer in the doc's graph (S4 ← S0): the agent declarations a session/worktree copies from. */
const GLOBAL_DECLARATION: Record<string, ModelRef> = {
  build_mode: { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
  plan_mode: { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
  coder_agent: { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" },
}

// ── T5 S1 — worktree without settings ← global ──

describe("T5 S1 — a worktree with no settings is filled from global", () => {
  test("the empty worktree layer is completed from the global declaration and the file reads back full", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      // No worktree layer exists yet.
      expect(await readModelState()).toBeUndefined()

      const filled = fillWorkspaceAgents({}, undefined, AGENTS, (name) => GLOBAL_DECLARATION[name])
      expect(filled.filled).toEqual(AGENTS)
      expect(filled.unresolved).toEqual([])

      // Write it the way the TUI does (state/model.json), then read the FILE back.
      await writeModelState({ workspaceAgent: filled.workspaceAgent })
      const state = await readModelState()
      const workspaceAgent = (state?.workspaceAgent ?? {}) as Record<string, Record<string, ModelRef>>
      expect(unfilledWorkspaceAgents(workspaceAgent, undefined, AGENTS)).toEqual([])
      for (const name of AGENTS) {
        expect(workspaceAgentModel(name, undefined, state)).toEqual(GLOBAL_DECLARATION[name])
      }
    })
  })

  test("the TUI fill source walks worktree → global declaration, ending in undefined — never an invented model", () => {
    // Structural half, the same instrument as fill-layers.test.ts: `fillWorktreeLayer` resolves
    // every agent through `fillSourceFor`; while the worktree is still empty, the branch that
    // answers is the GLOBAL declaration — the S1 link this smoke names.
    const LOCAL = fs
      .readFileSync(path.join(import.meta.dir, "../../src/cli/cmd/tui/context/local.tsx"), "utf8")
      .replace(/\r\n/g, "\n")
    const start = LOCAL.indexOf("function fillSourceFor(")
    expect(start).toBeGreaterThan(-1)
    const end = LOCAL.indexOf("\n      }\n", start)
    expect(end).toBeGreaterThan(start)
    const source = LOCAL.slice(start, end)

    // Positive control: the same slice finds content that IS there.
    expect(source).toContain("workspaceAgentModel(")
    // S1's link: the worktree is consulted first…
    expect(source).toContain("const workspace = workspaceAgentModel(name, getActiveWorkspaceID()")
    // …and the empty-worktree branch resolves the GLOBAL agent declaration.
    expect(source).toContain("const a = sync.data.agent.find((x) => x.name === name)")
    expect(source).toContain(
      "if (a?.model) return { model: `${a.model.providerID}/${a.model.modelID}`, variant: a.variant }",
    )
    // The chain ENDS in undefined — a layer with no source is reported, never defaulted.
    expect(source).toContain("return undefined")
  })
})

// ── T5 S4 — copy, not link ──

describe("T5 S4 — copy, not link: a worktree change never flows into the session", () => {
  test("the session file keeps the copied value after the worktree moves on", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      const sid = "ses_s4"
      const copied = { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }
      const moved = { providerID: "opencode", modelID: "big-pickle" }

      // 1. The worktree layer holds the original choice.
      await writeModelState({ workspaceAgent: { [WS]: { build_mode: copied } } })

      // 2. A new session is FILLED from it — the COPY.
      const state = await readModelState()
      const filled = fillSessionAgents(null, ["build_mode"], (name) => {
        const w = workspaceAgentModel(name, WS, state)
        return w ? { model: `${w.providerID}/${w.modelID}` } : undefined
      })
      expect(filled.unresolved).toEqual([])
      await saveSessionSettings(sid, filled.settings)

      // 3. The worktree moves on — a later pick rewrites state/model.json.
      await writeModelState({ workspaceAgent: { [WS]: { build_mode: moved } } })

      // 4. Read BOTH FILES back: the session kept its copy; the worktree holds the new pick.
      const session = await loadSessionSettings(sid)
      expect(sessionAgentModel("build_mode", session)).toEqual(copied)
      expect(workspaceAgentModel("build_mode", WS, await readModelState())).toEqual(moved)

      // 5. Re-filling the SAME session is a no-op — nothing is re-synced from above.
      const again = fillSessionAgents(session, ["build_mode"], () => ({
        model: `${moved.providerID}/${moved.modelID}`,
      }))
      expect(again.filled).toEqual([])
      expect(sessionAgentModel("build_mode", again.settings)).toEqual(copied)

      // 6. The unified resolver answers from the session layer FIRST — the wire value is the copy.
      await expect(resolveAgentModel("build_mode", { sessionID: sid, workspaceID: WS })).resolves.toEqual(copied)

      // 7. The direction that DOES exist: a session created AFTER the pick copies the new value.
      const after = await readModelState()
      const fresh = fillSessionAgents(null, ["build_mode"], (name) => {
        const w = workspaceAgentModel(name, WS, after)
        return w ? { model: `${w.providerID}/${w.modelID}` } : undefined
      })
      await saveSessionSettings("ses_s4_new", fresh.settings)
      expect(sessionAgentModel("build_mode", await loadSessionSettings("ses_s4_new"))).toEqual(moved)
    })
  })
})

// ── T4 — every server fallback below the session layer is recorded ──

describe("T4 — a fall below the session layer is recorded on every server path", () => {
  const PROMPT = fs
    .readFileSync(path.join(import.meta.dir, "../../src/session/prompt.ts"), "utf8")
    .replace(/\r\n/g, "\n")

  test("all three server fallbacks carry the bug-warn", () => {
    // The prompt site came with the T7 commit; shell and command are closed by T4 (refined).
    expect(PROMPT).toContain('"bug: prompt model fell through the session layer"')
    expect(PROMPT).toContain('"bug: shell model fell through the session layer"')
    expect(PROMPT).toContain('"bug: command model fell through the session layer"')
  })

  test("the shell fallback records the source that answered, and the CLI chain stays intact", () => {
    const warn = PROMPT.indexOf('"bug: shell model fell through the session layer"')
    expect(warn).toBeGreaterThan(-1)
    const guard = PROMPT.lastIndexOf("if (!input.model) {", warn)
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(warn) // the guard arms the record…
    // …and the original fallback expression still resolves after it (CLI/scripts keep working).
    const fallback = PROMPT.indexOf("const model = input.model ?? agent.model")
    expect(fallback).toBeGreaterThan(warn)
    expect(PROMPT).toContain("const model = input.model ?? agent.model ?? (yield* lastModel(input.sessionID))")
    expect(PROMPT.slice(warn, fallback)).toContain('agent.model ? "agent-declaration" : "last-message/default"')
  })

  test("the command chain labels the source it used and keeps every branch", () => {
    const chain = PROMPT.indexOf("const taskModelSource = yield* Effect.gen(")
    const warn = PROMPT.indexOf('"bug: command model fell through the session layer"')
    expect(chain).toBeGreaterThan(-1)
    expect(warn).toBeGreaterThan(chain) // the resolution is READ, then recorded
    const end = PROMPT.indexOf("const userModel = isSubtask", warn)
    expect(end).toBeGreaterThan(warn)
    const slice = PROMPT.slice(chain, end)
    // One label per source, and the session label exists — "below the session layer" is a
    // statement about which source ANSWERED, not a guess.
    expect(slice).toContain('used: "command-declaration"')
    expect(slice).toContain('used: "agent-declaration"')
    expect(slice).toContain('used: "session"')
    expect(slice).toContain('used: "last-message/default"')
    expect(slice).toContain('taskModelSource.used !== "session"')
    expect(slice).toContain("const taskModel = taskModelSource.model")
    // Every original branch still resolves — command declaration, agent declaration, payload, last used.
    expect(slice).toContain("if (cmd.model) return ")
    expect(slice).toContain("if (cmd.agent) {")
    expect(slice).toContain("if (cmdAgent?.model) return ")
    expect(slice).toContain("if (input.model) return ")
    expect(slice).toContain('return { model: yield* lastModel(input.sessionID), used: "last-message/default" }')
  })
})
