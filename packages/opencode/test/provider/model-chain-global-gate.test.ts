/**
 * t87 RED — a chain layer filled before the global list changed is gated at USE
 * (plan `plans/2026-10-18_global-recents-constraint.md` §3-§4).
 *
 * `opts.globalRecents` is the planned t87 plumbing — the L4 allowlist read at
 * use time, riding the options bag (runtime-ignored by today's code). Each test
 * fails on today's code FOR THE STATED REASON: the first UP member is assigned
 * without any membership check.
 */
import { describe, expect, test } from "bun:test"
import fs from "fs"
import path from "path"
import type { ChainHealth, ChainMember } from "@/provider/model-chain/chain"
import { resolveChainAgentModel } from "@/session/session-settings"

const STALE: ChainMember = { providerID: "opencode-go", modelID: "glm-5.3-flash" }
const BACKUP: ChainMember = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" }
/** The ordered allowlist (free zen -> contributor via Go); the ADID pick is absent. */
const GLOBAL_RECENTS = ["opencode/muse-spark-1.3-contributor-free", "opencode-go/muse-spark-1.3-contributor"]

describe("t87 — a chain head outside global recents is not assigned", () => {
  test("chain [stale] gates to undefined so the caller falls to the legacy path", () => {
    const member = resolveChainAgentModel("build_mode", "ses_t87_chain", new Map<string, ChainHealth>(), {
      chain: [STALE],
      globalRecents: GLOBAL_RECENTS,
    } as any)
    // Gated at USE: nothing in-list remains, warn + undefined (the `bug:` warn
    // lives at the refusal site), never the stale member.
    expect(member).toBeUndefined()
  })

  test("chain [stale, backup-in-list] assigns the backup — failover preserved, staleness filtered", () => {
    const member = resolveChainAgentModel("build_mode", "ses_t87_chain", new Map<string, ChainHealth>(), {
      chain: [STALE, BACKUP],
      globalRecents: GLOBAL_RECENTS,
    } as any)
    expect(member).toEqual(BACKUP)
  })
})

describe("t87 — structural: the chain resolver source carries the gate", () => {
  test("resolveChainAgentModel checks the same global key and warns on refusal", () => {
    const SRC = fs
      .readFileSync(path.join(import.meta.dir, "../../src/session/session-settings.ts"), "utf8")
      .replace(/\r\n/g, "\n")
    const start = SRC.indexOf("export function resolveChainAgentModel(")
    expect(start).toBeGreaterThan(-1)
    const end = SRC.indexOf("\n}\n", start)
    expect(end).toBeGreaterThan(start)
    const body = SRC.slice(start, end)
    expect(body).toContain("globalRecents")
    expect(body).toContain("not in global recents")
  })
})
