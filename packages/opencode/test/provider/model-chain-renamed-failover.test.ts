/**
 * t87 renamed/withdrawn model case — RED then GREEN.
 *
 * Owner (verbatim): «Вот мы вчера использовали халявную тестовую модель — все гуд —
 * тестирование закончилось и модель уже по другому называется … а как вернуть в
 * нормальное русло?» One edit of `globalRecents` (old → new name) must move every
 * worktree's next turn to the new name; no `model.json` is touched; no guessed alias
 * ever replaces the dead id.
 *
 * R1/R5/R6 are RED on today's code FOR THE STATED REASON (no gate, no withdrawn
 * class, no list-head fallback). R2/R3/R4/R7 pin the existing t68 failover contract
 * (terminal → DOWN + same-turn next UP + visible note) — they pass today and must
 * stay green: the response shape comes from provider code (`classify.ts:49,81,90`,
 * `stream-failover.ts:296` synthesizes `Model not found: <key>` exactly so).
 */
import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { mkdir, writeFile } from "fs/promises"
import { mkdirSync } from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { tmpdir } from "../fixture/fixture"
import { assignChainModel } from "@/provider/model-chain/assign"
import { memberKey } from "@/provider/model-chain/chain"
import type { ChainHealth, ChainMember } from "@/provider/model-chain/chain"
import { buildSwitchNote, decideStreamError, runChainStream, toChainError } from "@/provider/model-chain/stream-failover"
import { classifyChainError } from "@/provider/model-chain/classify"
import { readModelState, resolveAgentModel } from "../../src/session/session-settings"

setDefaultTimeout(20_000)

const OLD_NAME: ChainMember = { providerID: "opencode-go", modelID: "old-test-model" }
const NEW_HEAD: ChainMember = { providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }
const NEW_BACKUP: ChainMember = { providerID: "opencode-go", modelID: "muse-spark-1.3-contributor" }
/** One owner edit: the old name is gone, the new names stand in its order. */
const NEW_LIST = ["opencode/muse-spark-1.3-contributor-free", "opencode-go/muse-spark-1.3-contributor"]

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

async function writeModelState(state: Record<string, unknown>) {
  const file = path.join(Global.Path.state, "model.json")
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state))
}

async function readModelStateRaw(): Promise<string> {
  const { readFile } = await import("fs/promises")
  return readFile(path.join(Global.Path.state, "model.json"), "utf8")
}

describe("t87 renamed — «withdrawn» at the provider is TERMINAL", () => {
  test("R1: a withdrawn list member (400, no 404) marks DOWN at once, zero retries", () => {
    expect(
      classifyChainError({
        message: "model withdrawn: opencode-go/old-test-model is no longer available",
        statusCode: 400,
      }),
    ).toBe("terminal")
  })

  test("R2 pin: provider 404 and «Model not found» stay terminal (precedent: t68)", () => {
    expect(classifyChainError({ message: "Model not found: opencode-go/old-test-model", statusCode: 404 })).toBe(
      "terminal",
    )
    expect(classifyChainError({ message: "model_not_found", statusCode: 400 })).toBe("terminal")
  })

  test("R3 pin: terminal refusal marks the dead member DOWN and proceeds same-turn", () => {
    const health = new Map<string, ChainHealth>()
    const decision = decideStreamError({
      chain: [OLD_NAME, NEW_BACKUP],
      health,
      now: () => 0,
      failed: OLD_NAME,
      error: { message: "Model not found: opencode-go/old-test-model", statusCode: 404 },
    })
    expect(decision.action).toBe("next")
    expect(health.get(memberKey(OLD_NAME))?.status).toBe("DOWN")
    if (decision.action === "next") {
      expect(decision.member).toEqual(NEW_BACKUP)
      expect(decision.attemptsOnFailed).toBe(1)
    }
  })

  test("R4 pin: the switch note names the dead id — never a silent swap", () => {
    const note = buildSwitchNote({
      prevKey: memberKey(OLD_NAME),
      nextKey: memberKey(NEW_BACKUP),
      reason: "terminal: Model not found: opencode-go/old-test-model",
      keptChars: 0,
    })
    expect(note).toContain(memberKey(OLD_NAME))
    expect(note).toContain(memberKey(NEW_BACKUP))
  })
})

describe("t87 renamed — one globalRecents edit moves every worktree, nothing touched", () => {
  test("R5: two stale worktrees gate to undefined and their model.json files are byte-identical", async () => {
    await using tmp = await tmpdir()
    await withDataDir(tmp, async () => {
      for (const ws of ["wrk_t87_a", "wrk_t87_b"]) {
        await writeModelState({ workspaceAgent: { [ws]: { build_mode: OLD_NAME } } })
      }
      const before = await readModelStateRaw()
      for (const ws of ["wrk_t87_a", "wrk_t87_b"]) {
        const resolved = await resolveAgentModel(
          "build_mode",
          { sessionID: `ses_t87_${ws}`, workspaceID: ws },
          { globalRecents: NEW_LIST } as any,
        )
        expect(resolved).toBeUndefined()
      }
      expect(await readModelState()).toBeDefined()
      expect(await readModelStateRaw()).toBe(before)
    })
  })

  test("R6: the assign path falls back to the list head — the new name runs next turn", () => {
    const assignment = assignChainModel("ses_t87_rename", "build_mode", {
      load: () => [OLD_NAME],
      health: new Map<string, ChainHealth>(),
      globalRecents: NEW_LIST,
      noteUse: () => undefined,
    } as any)
    expect(assignment?.model).toEqual({ providerID: NEW_HEAD.providerID, modelID: NEW_HEAD.modelID })
    expect(assignment?.note).toContain("global-recents")
  })
})

describe("t87 renamed — no guessed alias: the dead id never becomes another model", () => {
  test("R7 pin: provider 404 on the head runs the next UP member, verbatim, with the note first", async () => {
    interface StubModel {
      key: string
    }
    const deadModel: StubModel = { key: memberKey(OLD_NAME) }
    const backupModel: StubModel = { key: memberKey(NEW_BACKUP) }
    const deadError = () =>
      Object.assign(new Error(`Model not found: ${memberKey(OLD_NAME)}`), { statusCode: 404 })
    const stream = runChainStream<string, StubModel>({
      chain: [OLD_NAME, NEW_BACKUP],
      initialModel: deadModel,
      memberOf: (model) => (model.key === deadModel.key ? OLD_NAME : model.key === backupModel.key ? NEW_BACKUP : undefined),
      modelKey: (model) => model.key,
      run: (model, _abort) =>
        Effect.succeed({
          stream: (async function* (): AsyncGenerator<string> {
            if (model.key === deadModel.key) throw deadError()
            yield "hello from backup"
          })(),
        }),
      resolveModel: (member) =>
        Effect.succeed(member === OLD_NAME ? deadModel : member === NEW_BACKUP ? backupModel : undefined),
      health: new Map<string, ChainHealth>(),
      timeoutMs: 120_000,
      now: () => 0,
      schedule: () => () => {},
    })
    const collected = await Effect.runPromise(Stream.runCollect(stream))
    const elements = Array.from(collected)
    const note = elements.find(
      (element) => typeof element === "object" && element !== null && (element as { type?: string }).type === "chain-switch",
    ) as { prevKey: string; nextKey: string; reason: string } | undefined
    expect(note?.prevKey).toBe(memberKey(OLD_NAME))
    expect(note?.nextKey).toBe(memberKey(NEW_BACKUP))
    expect(note?.reason).toMatch(/terminal/)
    expect(elements).toContain("hello from backup")
    expect(elements.indexOf(note)).toBeLessThan(elements.indexOf("hello from backup"))
  })
})
