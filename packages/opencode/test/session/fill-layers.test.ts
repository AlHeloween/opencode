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
import fs from "fs"
import path from "path"
import { sessionAgentModel, type SessionSettings } from "../../src/session/session-settings"
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

// ── The READ half ──
//
// The ruling is a READ rule as much as a fill rule: the reader takes ONE layer and nothing else.
// The read lives in `local.tsx` (where the session-settings signal is) and `sessionAgentModel`
// (`session-settings.ts:157`) is its one implementation. BOTH ends are pinned, because the defect
// deleted on 2026-09-21 was a READ-TIME parent walk and the two ends fail on different mutations:
//
//   - the behavioural case fails if `sessionAgentModel` grows a fallback inside itself;
//   - the structural case fails if `local.tsx` stops delegating and walks worktree/declared again.
//
// The second is not hypothetical: it is the exact shape that was reverted.
const LOCAL_TSX = path.join(import.meta.dir, "../../src/cli/cmd/tui/context/local.tsx")
const SOURCE = fs.readFileSync(LOCAL_TSX, "utf8")

/** Slice ONE function body out of a source file: its signature line to its own closing line. */
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`the probe is BLIND, not the code: ${signature} is not in the file`)
  const end = source.indexOf("\n      }\n", start)
  if (end < 0) throw new Error(`the probe cannot delimit ${signature} — fix the instrument, not the code`)
  return source.slice(start, end)
}

describe("the read takes ONE layer", () => {
  test("the probe itself is not blind — the same slice finds a body that IS there", () => {
    // POSITIVE CONTROL. Without it a renamed file or a slice that never matches would make every
    // assertion below pass for the wrong reason — absence proved by a broken instrument.
    const fillSource = bodyOf(SOURCE, "function fillSourceFor(")
    expect(fillSource).toContain("workspaceAgentModel")
  })

  test("forAgent names ONE layer, and walks no parent chain", () => {
    const read = bodyOf(SOURCE, "function forAgent(")
    // The RETURN, not merely the call: a pin on `sessionAgentModel(` alone would pass with the
    // `return` dropped, and the read would then yield `undefined` silently — type-legal, and
    // invisible to typecheck. Pinning the returning form is what makes that failure impossible to
    // commit unnoticed.
    expect(read).toContain("return sessionAgentModel(name, sessionSettings())")
    // Naming the worktree is legitimate — it IS the governing layer when no session is open yet.
    // What must never come back is the WALK: a per-link validity filter deciding whether an upper
    // layer is "full enough", and a third source reached by searching the agent list.
    expect(read).not.toContain("isModelValid")
    expect(read).not.toContain("sync.data.agent")
  })

  test("no second spelling of the read survives beside it", () => {
    // `effectiveModelFor` was an identity wrapper over `forAgent` — a layer with no content.
    expect(SOURCE).not.toContain("effectiveModelFor")
  })

  test("one authority for an agent NAME, not a hedge between two spellings", () => {
    const source = bodyOf(SOURCE, "function fillSourceFor(")
    expect(source).toContain("canonicalIdentity(")
    // The hedge that stood here decided, at this one site, that two names are the same agent.
    // Pinned by SHAPE (`|| x.name ===`), not by a word — a word in a nearby comment must not be able
    // to make this pass or fail on its own.
    expect(source).not.toContain("|| x.name ===")
  })

  test("no model is INVENTED — a layer with no source is REPORTED, never defaulted", () => {
    // A hardcoded last-resort id made an unfilled layer indistinguishable from a real choice, so the
    // hole it hid could never be reported. The source chain must END in `undefined`, not a constant.
    expect(bodyOf(SOURCE, "function fillSourceFor(")).toContain("return undefined")
    // …and the worktree fill resolves through ONE source, with no connectivity gate on a WRITE.
    const fill = bodyOf(SOURCE, "function fillWorktreeLayer(")
    expect(fill).toContain("fillSourceFor(name)")
    expect(fill).not.toContain("isModelValid")
    expect(fill).not.toContain("sync.data.agent.find")
  })

  test("a fill hole is REPORTED as a bug, never left as a silent hole", () => {
    const refresh = bodyOf(SOURCE, "async function refreshSessionSettings(")
    expect(refresh).toContain("fillSessionAgents(")
    expect(refresh).toContain("unresolved.length > 0")
    expect(refresh).toContain("bug: session settings layer left unfilled")
  })

  test("sessionAgentModel reads the session's OWN entry", () => {
    expect(
      sessionAgentModel("build_mode", { agent: { build_mode: { model: "huggingface/zai-org/GLM-5.3-Flash-BF16" } } }),
    ).toEqual({ providerID: "huggingface", modelID: "zai-org/GLM-5.3-Flash-BF16" })
  })

  test("an empty session layer is undefined — layers handed alongside it are NOT consulted", () => {
    // Handed the layer above in the SAME object: a fallback reading it would answer here.
    const settings = {
      agent: {},
      workspaceAgent: { default: { build_mode: { providerID: "worktree", modelID: "from-above" } } },
      variant: { "worktree/from-above": "max" },
    } as unknown as SessionSettings
    expect(sessionAgentModel("build_mode", settings)).toBeUndefined()
  })

  test("a malformed stored value is refused, never repaired from elsewhere", () => {
    expect(sessionAgentModel("build_mode", { agent: { build_mode: { model: "no-slash" } } })).toBeUndefined()
    expect(sessionAgentModel("build_mode", { agent: { build_mode: { model: "/leading" } } })).toBeUndefined()
    expect(sessionAgentModel("build_mode", { agent: { build_mode: { model: "trailing/" } } })).toBeUndefined()
    expect(sessionAgentModel("build_mode", undefined)).toBeUndefined()
  })
})
