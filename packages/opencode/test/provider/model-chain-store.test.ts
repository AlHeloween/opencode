import { describe, expect, setDefaultTimeout, test } from "bun:test"
import type { Database as BunDatabase } from "bun:sqlite"
import { and, eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { ModelChainTable } from "@/provider/model-chain/chain.sql"
import {
  chainKey,
  fillChainForNewLayer,
  readChainLayer,
  shouldBackfill,
  validateChain,
} from "@/provider/model-chain/chain"
import type { ChainHealth, ChainMember } from "@/provider/model-chain/chain"
import { resolveChainAgentModel } from "@/session/session-settings"
import { assignChainModel } from "@/provider/model-chain/assign"

setDefaultTimeout(20_000)

const free: ChainMember = { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }
const go: ChainMember = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor", variant: "xhigh" }

/** Mirror of the `model_chain` block in `storage/db.ts` CORE_SCHEMA_SQL. */
const MODEL_CHAIN_DDL = `CREATE TABLE IF NOT EXISTS "model_chain" (
  scope text NOT NULL,
  agent text NOT NULL,
  data text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  PRIMARY KEY (scope, agent)
);`

describe("chain store contract", () => {
  test("chainKey addresses one agent in one layer", () => {
    expect(chainKey("global", "build_mode")).toBe("global:agent:build_mode:chain")
    expect(chainKey("worktree:default", "build_mode")).toBe("worktree:default:agent:build_mode:chain")
    expect(chainKey("session:ses_123", "coder_agent")).toBe("session:ses_123:agent:coder_agent:chain")
  })
  test("codec round-trip: validate -> JSON -> readChainLayer", () => {
    const stored = JSON.stringify([free, go])
    expect(readChainLayer(JSON.parse(stored))).toEqual([free, go])
  })
  test("codec rejects garbage to undefined, never a half-chain", () => {
    expect(readChainLayer(JSON.parse(`{"not":"a chain"}`))).toBeUndefined()
    expect(readChainLayer(JSON.parse(`[{"providerID":"opencode"}]`))).toBeUndefined()
  })
  test("fill-once copies the parent and never aliases it", () => {
    const parent = [free]
    const filled = fillChainForNewLayer(parent)
    expect(filled).toEqual([free])
    filled![0]!.modelID = "mutated"
    expect(parent[0]!.modelID).toBe("muse-spark-1.3-contributor-free")
  })
  test("shouldBackfill fires only on an empty layer", () => {
    expect(shouldBackfill(undefined)).toBe(true)
    expect(shouldBackfill(readChainLayer([]))).toBe(true)
    expect(shouldBackfill(readChainLayer([free]))).toBe(false)
  })
})

describe("model_chain table round-trip (:memory:)", () => {
  test("one row per (scope, agent); replace on conflict; read is one key", () => {
    const db = drizzle(":memory:")
    db.run(MODEL_CHAIN_DDL)
    const now = Date.now()
    const put = (scope: string, agent: string, members: ChainMember[]) => {
      db.insert(ModelChainTable)
        .values({ scope, agent, data: JSON.stringify(members), time_created: now, time_updated: now })
        .onConflictDoUpdate({
          target: [ModelChainTable.scope, ModelChainTable.agent],
          set: { data: JSON.stringify(members), time_updated: now },
        })
        .run()
    }
    const get = (scope: string, agent: string): ChainMember[] | undefined => {
      const row = db
        .select({ data: ModelChainTable.data })
        .from(ModelChainTable)
        .where(and(eq(ModelChainTable.scope, scope), eq(ModelChainTable.agent, agent)))
        .all()[0]
      if (!row) return undefined
      return readChainLayer(JSON.parse(row.data))
    }
    put("session:ses_1", "build_mode", [free, go])
    put("global", "build_mode", [go])
    expect(get("session:ses_1", "build_mode")).toEqual([free, go])
    expect(get("global", "build_mode")).toEqual([go])
    expect(get("session:ses_1", "coder_agent")).toBeUndefined()
    put("session:ses_1", "build_mode", [go])
    expect(get("session:ses_1", "build_mode")).toEqual([go])
    ;(db.$client as BunDatabase).close()
  })
})

describe("resolveChainAgentModel (C5 assignment)", () => {
  test("takes the first UP member of the session layer only", () => {
    const health = new Map<string, ChainHealth>([["opencode/muse-spark-1.3-contributor-free", { status: "DOWN", downAt: 0, reason: "402" }]])
    expect(resolveChainAgentModel("build_mode", "ses_1", health, { chain: [free, go] })).toEqual(go)
    expect(resolveChainAgentModel("build_mode", "ses_1", new Map(), { chain: [free, go] })).toEqual(free)
  })
  test("empty session layer warns and falls through (undefined), never walks to a parent", () => {
    expect(resolveChainAgentModel("build_mode", "ses_1", new Map(), { chain: undefined })).toBeUndefined()
    expect(resolveChainAgentModel("build_mode", "ses_1", new Map(), { chain: [] })).toBeUndefined()
  })
})

describe("assignChainModel (prompt_async wiring)", () => {
  test("assigns the first UP member with a visible note", () => {
    const seen = new Map<string, string>()
    const assignment = assignChainModel("ses_1", "build_mode", {
      load: () => [free, go],
      health: new Map(),
      noteUse: (sid, agent, member) => {
        const key = `${member.providerID}/${member.modelID}`
        const prev = seen.get(`${sid}:${agent}`)
        seen.set(`${sid}:${agent}`, key)
        if (prev === key) return undefined
        return prev
      },
    })
    expect(assignment?.model).toEqual({ providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" })
    expect(assignment?.note ?? "").toMatch(/chain assign opencode\/muse-spark-1.3-contributor-free/)
  })
  test("a mid-session switch names previous, new and reason", () => {
    const health = new Map<string, ChainHealth>([
      ["opencode/muse-spark-1.3-contributor-free", { status: "DOWN", downAt: 0, reason: "hang past 120s" }],
    ])
    const assignment = assignChainModel("ses_1", "build_mode", {
      load: () => [free, go],
      health,
      noteUse: () => "opencode/muse-spark-1.3-contributor-free",
    })
    expect(assignment?.model).toEqual({ providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" })
    expect(assignment?.note ?? "").toMatch(/chain switch .* → .* \(hang past 120s\)/)
  })
  test("empty session layer falls through (undefined), never to a parent", () => {
    expect(
      assignChainModel("ses_1", "build_mode", { load: () => undefined, health: new Map(), noteUse: () => undefined }),
    ).toBeUndefined()
  })
  test("legacy agent names resolve through the canonical key", () => {
    const seen = new Map<string, ChainMember[] | undefined>([["session:ses_9:build_mode", [go]]])
    const assignment = assignChainModel("ses_9", "build", {
      load: (scope, agent) => {
        expect(scope).toBe("session:ses_9")
        expect(agent).toBe("build_mode")
        return seen.get(`${scope}:${agent}`)
      },
      health: new Map(),
      noteUse: () => undefined,
    })
    expect(assignment?.model).toEqual({ providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" })
  })
})
