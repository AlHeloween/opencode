/**
 * `Snapshot.lastImpact()` reads sources that EXIST (plans/2026-09-29_codegraph-impact-decoupling.md, C5).
 *
 * It used to decode the fossil `sym` tag. Measured 2026-09-29: the live tag was EMPTY
 * (`sym=KINDS:none|TOP:none|XF:0`) and, since C1 took the CodeGraph touch off the commit path, nothing
 * writes it at all — so the decoder answered from a dead input. The reader now takes the BRIEF from
 * fossil (`info` → checkout/parent, `diff --brief` between them) and the IMPACT from the readonly
 * CodeGraph SQLite pack over those files — no MCP, no tag.
 *
 * Real fossil, real SQLite: the fixture index is a two-table database the pack reads with its own
 * queries, so a regression in either half shows here.
 */
import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "bun:sqlite"
import fs from "fs/promises"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { SnapshotFossil } from "../../src/snapshot/fossil"
import { Snapshot } from "../../src/snapshot"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Two real fossil check-ins per test: a loaded machine runs past bun's 5 s default (measured: 6.2 s and
// 8.9 s under four parallel suites), which would be a red that says nothing about the code.
setDefaultTimeout(20_000)

const it = testEffect(Layer.mergeAll(SnapshotFossil.defaultLayer, CrossSpawnSpawner.defaultLayer))

/** The smallest index `packGraphForFiles` can read: `nodes` + `edges`, one function in `a.ts`. */
function writeIndex(dir: string) {
  const db = new Database(path.join(dir, ".codegraph", "codegraph.db"), { create: true })
  try {
    db.run("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER)")
    db.run("CREATE TABLE edges (source TEXT, target TEXT, kind TEXT)")
    db.run("INSERT INTO nodes VALUES ('n1', 'function', 'alpha', 'a.ts', 1)")
  } finally {
    db.close()
  }
}

describe("snapshot.lastImpact", () => {
  it.live(
    "reads the brief from fossil and the impact from the graph — not the dead sym tag",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const snap = yield* Snapshot.Service
        yield* Effect.promise(() => fs.mkdir(path.join(dir, ".codegraph"), { recursive: true }))
        writeIndex(dir)
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "a.ts"), "export function alpha() {}\n", "utf-8"))
        const h1 = yield* snap.track()
        expect(h1).toBeTruthy()

        yield* Effect.promise(() =>
          fs.writeFile(path.join(dir, "a.ts"), "export function alpha() { return 1 }\n", "utf-8"),
        )
        const h2 = yield* snap.track([path.join(dir, "a.ts")])
        expect(h2).toBeTruthy()
        expect(h2).not.toBe(h1)

        const last = yield* snap.lastImpact()
        // The BRIEF: the last snapshot's own range, parent → checkout, naming the file it changed.
        expect(last.to).toBe(h2!)
        expect(last.from).toBe(h1!)
        expect(last.changedFiles).toBe(1)
        // The IMPACT: the graph's element for that file, read from SQLite — no tag was ever written.
        expect(last.topSymbols).toContain("alpha[function]")
        expect(last.symbolCountByKind).toEqual({ function: 1 })
      }),
    ),
  )

  it.live(
    "with no CodeGraph index it FAILS naming the missing index, like impact() — never an empty answer",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const snap = yield* Snapshot.Service
        yield* Effect.promise(() => fs.writeFile(path.join(dir, "note.md"), "v1", "utf-8"))
        expect(yield* snap.track()).toBeTruthy()
        const exit = yield* Effect.exit(snap.lastImpact())
        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(".codegraph")
      }),
    ),
  )
})
