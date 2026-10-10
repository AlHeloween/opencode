import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "bun:sqlite"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { vectorSign } from "@/memory/spine"
import { Snapshot } from "@/snapshot"
import { SnapshotFossil } from "@/snapshot/fossil"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

setDefaultTimeout(20_000)

const it = testEffect(Layer.mergeAll(SnapshotFossil.defaultLayer, CrossSpawnSpawner.defaultLayer))
const firstID = "c79e24b18f603ad5e2a890764bd1f3c6"
const secondID = "f61b83a90c724ed5b809d16e4a37c2f8"
const vector = (md5: string, prev: string) =>
  [
    "Keywords: fossil-roadmap 0.60, trajectory 0.25, recovery 0.15",
    "Semantic dominant: Полный вектор завершённого ответа сохраняет направление работы, веса и связь с предыдущим шагом без обращения к базе диалога.",
    `md5: ${md5}`,
    `prev-md5: ${prev}`,
    "parent-goal-md5: 00000000000000000000000000000000",
  ].join("\n")

function comment(repo: string, hash: string) {
  const db = new Database(repo, { readonly: true })
  try {
    const rows = db
      .query<
        { comment: string },
        [string]
      >("SELECT event.comment FROM event JOIN blob ON blob.rid = event.objid WHERE event.type = 'ci' AND blob.uuid LIKE ?")
      .all(`${hash}%`)
    expect(rows).toHaveLength(1)
    return rows[0]!.comment
  } finally {
    db.close()
  }
}

describe("Fossil SV roadmap", () => {
  it.live(
    "persists the complete reply vector on a file snapshot and keeps restore working",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const snap = yield* Snapshot.Service
        const ctx = yield* InstanceState.context
        const repo = path.join(ctx.worktree, ".opencode", "data", "fossil", ctx.project.id, "snapshot.fsl")
        const file = path.join(dir, "note.txt")
        yield* Effect.promise(() => fs.writeFile(file, "v1", "utf8"))
        const yaml = vector(firstID, "8b7fa260c1e94d35a6f0289e73bc451d")
        const hash = yield* snap.track(undefined, vectorSign(`Ответ.\n\`\`\`yaml\n${yaml}\n\`\`\``))
        expect(hash).toBeTruthy()
        expect(comment(repo, hash!)).toStartWith(`auto-snapshot sv:${firstID}`)
        expect(comment(repo, hash!)).toEndWith(`\n\n${yaml}`)
        const info = execFileSync("fossil", ["info", hash!], { cwd: dir, encoding: "utf8", timeout: 10_000 })
        for (const field of ["Keywords:", "Semantic dominant:", "md5:", "prev-md5:", "parent-goal-md5:"])
          expect(info).toContain(field)
        yield* Effect.promise(() => fs.writeFile(file, "v2", "utf8"))
        const next = yield* snap.track([file])
        expect(next).not.toBe(hash)
        yield* snap.revertTo(hash!)
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("v1")
      }),
    ),
  )

  it.live(
    "records successive signed read-only turns while unsigned no-op keeps the current leaf",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const snap = yield* Snapshot.Service
        const ctx = yield* InstanceState.context
        const repo = path.join(ctx.worktree, ".opencode", "data", "fossil", ctx.project.id, "snapshot.fsl")
        const file = path.join(dir, "note.txt")
        yield* Effect.promise(() => fs.writeFile(file, "same tree", "utf8"))
        const baseline = yield* snap.track()
        expect(baseline).toBeTruthy()
        expect(yield* snap.track()).toBe(baseline)
        const yaml1 = vector(firstID, "8b7fa260c1e94d35a6f0289e73bc451d")
        const first = yield* snap.track(undefined, vectorSign(yaml1))
        expect(first).toBeTruthy()
        expect(first).not.toBe(baseline)
        expect(comment(repo, first!)).toEndWith(`\n\n${yaml1}`)
        const yaml2 = vector(secondID, firstID)
        const second = yield* snap.track([], vectorSign(yaml2))
        expect(second).toBeTruthy()
        expect(second).not.toBe(first)
        expect(comment(repo, second!)).toEndWith(`\n\n${yaml2}`)
        expect(yield* snap.track()).toBe(second)
        expect(yield* snap.track([file])).toBe(second)
        expect(
          execFileSync("fossil", ["diff", "--from", baseline!, "--to", second!], {
            cwd: dir,
            encoding: "utf8",
            timeout: 10_000,
          }),
        ).toBe("")
        expect(yield* Effect.promise(() => fs.readFile(file, "utf8"))).toBe("same tree")
      }),
    ),
  )

  it.live(
    "snapshot false also disables signed roadmap records",
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const snap = yield* Snapshot.Service
          expect(yield* snap.track(undefined, vectorSign(vector(firstID, secondID)))).toBeUndefined()
        }),
      { config: { snapshot: false } },
    ),
  )
})
