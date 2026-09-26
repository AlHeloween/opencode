import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import { canActivateAgent, readLayer, shouldActivateAgent, shouldUpdateSessionModelOnPick, writesWorktreeOnPick } from "../../src/cli/cmd/tui/util/agent"
import { activeSessionID } from "../../src/cli/cmd/tui/context/local"
import { availableScopes, coerceScope, phaseScope, readScope } from "../../src/cli/cmd/tui/component/config-scope"
import { sessionAgentModel, setSessionAgentModel, setWorkspaceAgentModel, workspaceAgentModel } from "../../src/session/session-settings"
import { fillSessionAgents } from "../../src/session/fill-layers"

const agents = [
  { name: "build_mode", mode: "primary" },
  { name: "explorer_agent", mode: "subagent" },
]

test("TUI does not make a configured subagent the active prompt agent", () => {
  expect(canActivateAgent("explorer_agent", agents)).toBe(false)
  expect(canActivateAgent("build_mode", agents)).toBe(true)
})

test("configuring another agent's model from /agents does not move the active agent", () => {
  // /agents passes an explicit target — configuring it must never hijack the prompt.
  expect(shouldActivateAgent("plan_mode", "plan_mode", agents)).toBe(false)
  expect(shouldActivateAgent("build_mode", "build_mode", agents)).toBe(false)
  // /model passes no target — the resolved current agent may still activate.
  expect(shouldActivateAgent("build_mode", undefined, agents)).toBe(true)
  expect(shouldActivateAgent("explorer_agent", undefined, agents)).toBe(false)
})

test("a worktree pick updates the open session for ANY agent — the session never stays stale", () => {
  const picked = { providerID: "deepseek", modelID: "deepseek-v4-pro" }
  const before = { agent: { general_agent: { model: "opencode/big-pickle" } } }
  // Owner, 2026-09-26: «я выбрал deepseek в worktree — а стоит бигпикл».
  expect(shouldUpdateSessionModelOnPick("worktree", true)).toBe(true)
  const after = setSessionAgentModel(before, "general_agent", `${picked.providerID}/${picked.modelID}`, undefined)
  expect(sessionAgentModel("general_agent", after)).toEqual(picked)
  // Session scope also lands in the layer; global stays a config write; no session → no write.
  expect(shouldUpdateSessionModelOnPick("session", true)).toBe(true)
  expect(shouldUpdateSessionModelOnPick("global", true)).toBe(false)
  expect(shouldUpdateSessionModelOnPick("worktree", false)).toBe(false)
})

/**
 * Owner, 2026-09-26 (verbatim): «после последнего фикса /agents worktree и /agents/ session стали
 * связанными. Меняешь session меняется worktree».
 *
 * The chain global → worktree → session is FILLED, not resolved, so a layer holds one fact about
 * one agent's model and a pick writes the layer it edits. The two directions are NOT symmetric and
 * both halves are pinned here, because either half alone is a different defect: a pick that stops
 * reaching the open session leaves the wire on the old model (owner, 2026-09-26: «я выбрал deepseek
 * в worktree — а стоит бигпикл»), and a pick that also writes the worktree is the fusion reported.
 */
test("a session pick writes the session and nothing else — the carry DOWN stays one-way", () => {
  // The reported defect: a session-scoped pick must NOT reach the worktree layer.
  expect(writesWorktreeOnPick("session")).toBe(false)
  // A worktree pick writes its own layer, and a scopeless one (hotkey, /model, startup --model)
  // is «a choice for THIS request» — it legitimately writes both.
  expect(writesWorktreeOnPick("worktree")).toBe(true)
  expect(writesWorktreeOnPick(undefined)).toBe(true)
  // Global is a config write and touches neither local layer.
  expect(writesWorktreeOnPick("global")).toBe(false)

  // session pick → the session layer.
  expect(shouldUpdateSessionModelOnPick("session", true)).toBe(true)
  // worktree pick → its own layer + the carry DOWN into an open session.
  expect(shouldUpdateSessionModelOnPick("worktree", true)).toBe(true)
  // global writes no local layer at all; with no session open there is nothing to carry into.
  expect(shouldUpdateSessionModelOnPick("global", true)).toBe(false)
  expect(shouldUpdateSessionModelOnPick("worktree", false)).toBe(false)
})

test("a session pick never mutates the worktree map it is supposed to be independent of", () => {
  const picked = { providerID: "deepseek", modelID: "deepseek-v4-pro" }
  const worktree = setWorkspaceAgentModel({}, undefined, "build_mode", {
    providerID: "opencode",
    modelID: "big-pickle",
  })
  // The session layer is a plain record — writing it leaves the worktree record identical.
  const session = setSessionAgentModel(null, "build_mode", `${picked.providerID}/${picked.modelID}`, undefined)

  expect(sessionAgentModel("build_mode", session)).toEqual(picked)
  expect(workspaceAgentModel("build_mode", undefined, { workspaceAgent: worktree })).toEqual({
    providerID: "opencode",
    modelID: "big-pickle",
  })
})

/**
 * The behavioural half of the same rule, pinned at the WRITE site.
 *
 * The table above proves what the predicate ANSWERS; it cannot prove that the write path ASKS it.
 * The fusion was one unconditional line, and a green suite is exactly what shipped it — so this
 * reads the source, in the same shape as `fill-layers.test.ts` (`bodyOf` + a positive control),
 * because a slice that stops matching would otherwise pass every assertion for the wrong reason.
 */
describe("the write path asks the predicate", () => {
  const SOURCE = fs
    .readFileSync(path.join(import.meta.dir, "../../src/cli/cmd/tui/context/local.tsx"), "utf8")
    .replace(/\r\n/g, "\n")

  /** Slice one region out of a source file. Throws when a marker is missing — a broken probe
   *  must be loud, never silently permissive. */
  function between(from: string, to: string): string {
    const start = SOURCE.indexOf(from)
    if (start < 0) throw new Error(`the probe is BLIND, not the code: ${from} is not in the file`)
    const end = SOURCE.indexOf(to, start)
    if (end < 0) throw new Error(`the probe cannot delimit ${from} — fix the instrument, not the code`)
    return SOURCE.slice(start, end)
  }

  // `set()` runs from its parameter line to the next method of the same object.
  const SET = between(
    "options?: { recent?: boolean; agent?: string; scope?: ModelScope },",
    "toggleFavorite(model: { providerID: string; modelID: string }) {",
  )

  test("the slice is not blind — it finds a body that IS there", () => {
    expect(SET).toContain("isModelValid(model)")
  })

  test("the worktree write sits BEHIND the predicate, and there is exactly one such write", () => {
    const guard = SET.indexOf("writesWorktreeOnPick(options.scope)")
    const write = SET.indexOf('setModelStore("workspaceAgent"')
    expect(guard).toBeGreaterThan(-1)
    expect(write).toBeGreaterThan(-1)
    // The guard is read BEFORE the write, so the session scope is filtered out of the worktree.
    expect(guard).toBeLessThan(write)
    // One write, not a second one added beside the guarded one.
    expect(SET.split('setModelStore("workspaceAgent"').length - 1).toBe(1)
  })

  test("no session layer is FILLED or written from the home route", () => {
    // The read side of the neighbour-session defect was T7; the write side is this gate, one
    // function earlier. `getActiveSessionID()` resolves the NEWEST session on `home`, so using it
    // here persisted a fill into a session that was never open.
    const refresh = between("async function refreshSessionSettings(", "\n      }\n")
    expect(refresh).toContain('route.data.type === "session" ? getActiveSessionID() : undefined')
    expect(refresh).toContain("fillSessionAgents(")
  })
})

test("TUI session settings follow the open session instead of its newest child", () => {
  const sessions = [{ id: "parent" }, { id: "child" }]

  expect(activeSessionID({ type: "session", sessionID: "parent" }, sessions)).toBe("parent")
  expect(activeSessionID({ type: "home" }, sessions)).toBe("child")
})

/**
 * Owner, 2026-09-26, live on 10.0.1124: the prompt read «Build · DeepSeek V4.1 Flash · max»
 * while `/agents` (phase = worktree) showed «Big Pickle» — the first screen was answering with a
 * NEIGHBOUR session's layer because `forAgent` used `getActiveSessionID()`, and on `home` that
 * resolver returns the newest session (`:54-57`) for WRITE bookkeeping. The read predicate is the
 * route alone: with no session OPEN the worktree governs — exactly what a session created from
 * here is filled from — so the first screen and the dialog name the same layer.
 */
test("the first screen reads the WORKTREE layer — a neighbour session must not answer for it", () => {
  expect(readLayer("home")).toBe("worktree")
  expect(readLayer("session")).toBe("session")
})

/**
 * Owner invariant, 2026-09-21 (verbatim): «Настройки новой сессии должны копироваться из
 * настроек worktree, а сейчас они копируются непонятно откуда».
 *
 * The chain is global → worktree → session, filled not resolved. Two rules are pinned here:
 *  1. a pick must name a layer that can actually hold it (a bare picker open with the shared
 *     KV scope must not target a dead layer);
 *  2. the worktree must LEARN the pick, because the worktree is the layer a new session is
 *     filled from — a stale worktree is how the next session started on the previous model.
 */
test("a pick coerces to a layer that can hold it — the session layer is dropped with no session", () => {
  // kv.json in practice holds "session"; a picker opened bare reads exactly this.
  const stored = readScope("session")

  // No session open: "session" would land nowhere, so the pick falls to the worktree —
  // the layer the settings surfaces display too, so both screens name the same place.
  expect(coerceScope(stored, availableScopes(false))).toBe("worktree")
  // With a session open the layer is real and stays.
  expect(coerceScope(stored, availableScopes(true))).toBe("session")
  // Coercion walks down one parent at a time, never sideways.
  expect(coerceScope("session", ["global", "worktree"])).toBe("worktree")
  expect(coerceScope("worktree", ["global"])).toBe("global")
})

test("a pick reaches the worktree, and a NEW session is filled from it — per agent", () => {
  const picked = { providerID: "openai", modelID: "gpt-5.6-sol" }
  const other = { providerID: "deepseek", modelID: "deepseek-flash" }

  // The worktree records the pick (setWorkspaceAgentModel is what local.model.set writes).
  let worktree = setWorkspaceAgentModel({}, undefined, "build_mode", picked)
  worktree = setWorkspaceAgentModel(worktree, undefined, "plan_mode", other)

  expect(workspaceAgentModel("build_mode", undefined, { workspaceAgent: worktree })).toEqual(picked)

  // A brand-new session has no entries: it is FILLED from the worktree, per agent.
  const next = fillSessionAgents(null, ["build_mode", "plan_mode"], (name) => {
    const w = workspaceAgentModel(name, undefined, { workspaceAgent: worktree })
    return w ? { model: `${w.providerID}/${w.modelID}` } : undefined
  })

  expect(next.unresolved).toEqual([])
  expect(next.settings.agent?.build_mode?.model).toBe("openai/gpt-5.6-sol")
  expect(next.settings.agent?.plan_mode?.model).toBe("deepseek/deepseek-flash")
})

describe("phase scope — the layer /agents opens on", () => {
  test("global until the worktree layer is materialised", () => {
    expect(phaseScope({ globalFilled: false, worktreeFilled: false, hasSession: false, sessionFilled: false })).toBe(
      "global",
    )
    expect(phaseScope({ globalFilled: true, worktreeFilled: false, hasSession: true, sessionFilled: true })).toBe(
      "global",
    )
  })

  test("worktree for a new session whose session layer is still empty", () => {
    expect(phaseScope({ globalFilled: true, worktreeFilled: true, hasSession: false, sessionFilled: false })).toBe(
      "worktree",
    )
    expect(phaseScope({ globalFilled: true, worktreeFilled: true, hasSession: true, sessionFilled: false })).toBe(
      "worktree",
    )
  })

  test("session when every layer is populated", () => {
    expect(phaseScope({ globalFilled: true, worktreeFilled: true, hasSession: true, sessionFilled: true })).toBe(
      "session",
    )
  })
})

