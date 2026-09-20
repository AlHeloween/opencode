/**
 * Fill every settings layer — the invariant tests.
 *
 * Owner ruling (2026-09-20, verbatim): «As I said before - there is global settings all models
 * must be !!!set!!!. For new worktree values copied from global - all values must be set. When
 * we create setting values must be taken from worktree - all values must be set. If not then
 * copied from previous BUT !!!WE MUST use only config from session!!!. Missing model at any
 * config settings from global till worktree and session - ANY - all tests failed.» and «Reading
 * model config not from session settings also all tests failed.»
 *
 * So each layer gets its own case below, and the cases are written so that a MISSING model in
 * ANY layer fails rather than passing quietly — including the read that must come from the
 * session and nowhere else.
 */
import { describe, expect, test } from "bun:test"
import {
  fillSessionAgents,
  fillWorkspaceAgents,
  modelKey,
  parseModelKey,
  unfilledSessionAgents,
  unfilledWorkspaceAgents,
  withSessionAgentModel,
} from "../../src/session/fill-layers"

const AGENTS = ["build_mode", "plan_mode", "coder_agent", "explorer_agent"]
const WORKSPACE = "wrk_test"

describe("fill-layers: the stored form", () => {
  test("modelKey and parseModelKey round-trip, and a malformed value is refused", () => {
    expect(modelKey({ providerID: "huggingface", modelID: "zai-org/GLM-5.3-Flash-BF16" })).toBe(
      "huggingface/zai-org/GLM-5.3-Flash-BF16",
    )
    expect(parseModelKey("huggingface/zai-org/GLM-5.3-Flash-BF16")).toEqual({
      providerID: "huggingface",
      modelID: "zai-org/GLM-5.3-Flash-BF16",
    })
    expect(parseModelKey("no-slash")).toBeUndefined()
    expect(parseModelKey("/leading")).toBeUndefined()
    expect(parseModelKey("trailing/")).toBeUndefined()
    expect(parseModelKey(undefined)).toBeUndefined()
  })
})

describe("fill-layers: SESSION layer is filled from the layer above", () => {
  test("a session with NO agent entries is filled for EVERY agent", () => {
    const source = (name: string) => ({ model: `global/${name}` })
    const result = fillSessionAgents(null, AGENTS, source)

    // A missing model in this layer fails HERE, for every agent — the point of the ruling.
    for (const name of AGENTS) {
      expect(result.settings.agent?.[name]?.model).toBe(`global/${name}`)
    }
    expect(result.filled).toEqual(AGENTS)
    expect(result.unresolved).toEqual([])
    expect(unfilledSessionAgents(result.settings, AGENTS)).toEqual([])
  })

  test("an agent that cannot be sourced is REPORTED, never left as a silent hole", () => {
    const source = (name: string) => (name === "planner" ? undefined : { model: `global/${name}` })
    const result = fillSessionAgents(null, [...AGENTS, "planner"], source)

    expect(result.unresolved).toEqual(["planner"])
    expect(result.filled).toEqual(AGENTS)
  })

  test("a session that already holds a model keeps it — a fill is a COPY, not a sync (S5)", () => {
    const existing = withSessionAgentModel(null, "build_mode", "session/mine", "high")
    const result = fillSessionAgents(existing, AGENTS, () => ({ model: "worktree/theirs", variant: "max" }))

    expect(result.settings.agent?.build_mode?.model).toBe("session/mine")
    expect(result.settings.agent?.build_mode?.variant).toBe("high")
    expect(result.filled).not.toContain("build_mode")
    // …and the change above is NOT pulled in later — the copy is independent by construction.
    expect(result.settings.agent?.plan_mode?.model).toBe("worktree/theirs")
  })

  test("the fill does NOT pin the variant sentinel — otherwise it would suppress the variant it copied", () => {
    const result = fillSessionAgents(null, ["build_mode"], () => ({ model: "global/m", variant: "max" }))
    expect(result.settings.agent?.build_mode?.variant).toBe("max")
    // The sentinel that the USER-facing setter pins must not appear from a fill.
    expect(result.settings.agentVariant).toBeUndefined()
  })

  test("filling twice is a no-op — the second pass reports nothing filled", () => {
    const once = fillSessionAgents(null, AGENTS, (name) => ({ model: `global/${name}` }))
    const twice = fillSessionAgents(once.settings, AGENTS, (name) => ({ model: `global/${name}` }))
    expect(twice.filled).toEqual([])
  })
})

describe("fill-layers: WORKTREE layer is filled from global", () => {
  test("an empty worktree map is filled for EVERY agent of the workspace (S3)", () => {
    const result = fillWorkspaceAgents({}, WORKSPACE, AGENTS, (name) => ({ providerID: "global", modelID: name }))

    for (const name of AGENTS) {
      expect(result.workspaceAgent[WORKSPACE]?.[name]).toEqual({ providerID: "global", modelID: name })
    }
    expect(result.filled).toEqual(AGENTS)
    expect(result.unresolved).toEqual([])
    expect(unfilledWorkspaceAgents(result.workspaceAgent, WORKSPACE, AGENTS)).toEqual([])
  })

  test("a half-filled worktree map is completed and reports only what was missing", () => {
    const partial = { [WORKSPACE]: { build_mode: { providerID: "mine", modelID: "kept" } } }
    const result = fillWorkspaceAgents(partial, WORKSPACE, AGENTS, (name) => ({ providerID: "global", modelID: name }))

    expect(result.workspaceAgent[WORKSPACE]?.build_mode).toEqual({ providerID: "mine", modelID: "kept" })
    expect(result.filled.sort()).toEqual(["coder_agent", "explorer_agent", "plan_mode"])
  })

  test("another workspace's entries are untouched", () => {
    const other = { other_scope: { build_mode: { providerID: "x", modelID: "y" } } }
    const result = fillWorkspaceAgents(other, WORKSPACE, AGENTS, (name) => ({ providerID: "global", modelID: name }))
    expect(result.workspaceAgent.other_scope).toEqual({ build_mode: { providerID: "x", modelID: "y" } })
  })

  test("an unresolvable agent is reported here too — no layer is allowed a gap", () => {
    const result = fillWorkspaceAgents({}, WORKSPACE, ["build_mode", "ghost"], () => undefined)
    expect(result.filled).toEqual([])
    expect(result.unresolved).toEqual(["build_mode", "ghost"])
  })
})
