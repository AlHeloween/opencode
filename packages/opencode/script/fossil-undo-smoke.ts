/**
 * Isolated Fossil full-leaf undo smoke — product Snapshot/SnapshotFossil only.
 * No TUI, no agent.
 *
 * Worktree default: <repo>/experiments/20260806_fossil_undo_smoke/wc
 *
 * Run from packages/opencode:
 *   bun script/fossil-undo-smoke.ts
 * Or: pwsh experiments/20260806_fossil_undo_smoke/run.ps1
 */
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { Snapshot } from "../src/snapshot"
import { SnapshotFossil } from "../src/snapshot/fossil"
import { Instance } from "../src/project/instance"
import { provideInstance } from "../test/fixture/fixture"
import * as Log from "@opencode-ai/core/util/log"

Log.init()

const REPO = path.resolve(import.meta.dirname!, "..", "..", "..")
const WC =
  process.argv[2] ??
  path.join(REPO, "experiments", "20260806_fossil_undo_smoke", "wc")

function fwd(...parts: string[]) {
  return path.join(...parts).replaceAll("\\", "/")
}

async function exists(p: string) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function read(p: string) {
  return (await fs.readFile(p, "utf-8")).replace(/\r\n/g, "\n").trimEnd()
}

async function write(p: string, text: string) {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, text, "utf-8")
}

async function listTxt(dir: string) {
  const names = await fs.readdir(dir)
  return names.filter((n) => n.endsWith(".txt")).sort()
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`)
}

async function cleanWc() {
  await fs.rm(WC, { recursive: true, force: true })
  await fs.mkdir(WC, { recursive: true })
  await write(path.join(WC, ".gitignore"), "node_modules\n.opencode/data\n")
}

function run<A>(body: (snapshot: Snapshot.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const snapshot = yield* Snapshot.Service
      return yield* body(snapshot)
    }).pipe(provideInstance(WC), Effect.provide(SnapshotFossil.defaultLayer)),
  )
}

async function step(label: string, fn: () => Promise<void>) {
  process.stdout.write(`  ${label} ... `)
  try {
    await fn()
    console.log("OK")
  } catch (e) {
    console.log("FAIL")
    throw e
  }
}

async function main() {
  console.log("=== Fossil undo smoke (isolated, no TUI) ===")
  console.log("wc:", WC)
  await cleanWc()

  let t0 = ""
  let t1 = ""
  let t2 = ""

  await step("S1 track T0 h1,h2", async () => {
    await write(path.join(WC, "h1.txt"), "h1")
    await write(path.join(WC, "h2.txt"), "h2")
    const h = await run((s) => s.track([fwd(WC, "h1.txt"), fwd(WC, "h2.txt")]))
    assert(h, "t0 hash")
    t0 = h!
  })

  await step("S1 track T1 h2prime+h3", async () => {
    await write(path.join(WC, "h2.txt"), "h2prime")
    await write(path.join(WC, "h3.txt"), "h3")
    const h = await run((s) => s.track([fwd(WC, "h2.txt"), fwd(WC, "h3.txt")]))
    assert(h, "t1 hash")
    assert(h !== t0, "t1 != t0")
    t1 = h!
  })

  await step("S1 track T2 h4", async () => {
    await write(path.join(WC, "h4.txt"), "h4")
    const h = await run((s) => s.track([fwd(WC, "h4.txt")]))
    assert(h, "t2 hash")
    t2 = h!
    assert((await listTxt(WC)).join(",") === "h1.txt,h2.txt,h3.txt,h4.txt", "T2 file set")
    assert((await read(path.join(WC, "h2.txt"))) === "h2prime", "h2prime")
  })

  await step("S2 revertTo T1 — no h4", async () => {
    await run((s) => s.revertTo(t1))
    assert((await listTxt(WC)).join(",") === "h1.txt,h2.txt,h3.txt", "T1 set")
    assert((await read(path.join(WC, "h2.txt"))) === "h2prime", "h2 still prime")
    assert(!(await exists(path.join(WC, "h4.txt"))), "h4 gone")
  })

  await step("S3 revertTo T0 — no h3/h4", async () => {
    await run((s) => s.revertTo(t0))
    assert((await listTxt(WC)).join(",") === "h1.txt,h2.txt", "T0 set")
    assert((await read(path.join(WC, "h2.txt"))) === "h2", "h2 v0")
    assert(!(await exists(path.join(WC, "h3.txt"))), "h3 gone")
    assert(!(await exists(path.join(WC, "h4.txt"))), "h4 gone")
  })

  await step("S4 checkout T2 redo leaf", async () => {
    await run((s) => s.checkout(t2))
    assert((await listTxt(WC)).join(",") === "h1.txt,h2.txt,h3.txt,h4.txt", "T2 restored")
    assert((await read(path.join(WC, "h2.txt"))) === "h2prime", "h2prime after redo")
    assert((await read(path.join(WC, "h4.txt"))) === "h4", "h4 content")
  })

  await step("S5 user-only survives undo", async () => {
    await write(path.join(WC, "user-only.txt"), "keep-me")
    await run((s) => s.revertTo(t0))
    assert(await exists(path.join(WC, "user-only.txt")), "user-only present")
    assert((await read(path.join(WC, "user-only.txt"))) === "keep-me", "user-only content")
    assert((await listTxt(WC)).filter((n) => n.startsWith("h")).join(",") === "h1.txt,h2.txt", "agent leaf T0")
  })

  await step("S6 rename a→b undo/redo", async () => {
    await write(path.join(WC, "a.txt"), "A")
    const r0 = await run((s) => s.track([fwd(WC, "a.txt")]))
    assert(r0, "r0")
    await fs.rename(path.join(WC, "a.txt"), path.join(WC, "b.txt"))
    await write(path.join(WC, "b.txt"), "B-edited")
    const r1 = await run((s) => s.track([fwd(WC, "a.txt"), fwd(WC, "b.txt")]))
    assert(r1, "r1")
    assert(!(await exists(path.join(WC, "a.txt"))), "pre-undo no a")
    assert((await read(path.join(WC, "b.txt"))) === "B-edited", "pre-undo b")

    await run((s) => s.revertTo(r0!))
    assert(await exists(path.join(WC, "a.txt")), "undo: a back")
    assert((await read(path.join(WC, "a.txt"))) === "A", "undo: A")
    assert(!(await exists(path.join(WC, "b.txt"))), "undo: no b")

    await run((s) => s.checkout(r1!))
    assert(!(await exists(path.join(WC, "a.txt"))), "redo: no a")
    assert((await read(path.join(WC, "b.txt"))) === "B-edited", "redo: B-edited")
  })

  await step("S7 invalid hash fails loud", async () => {
    let failed = false
    try {
      await run((s) => s.revertTo("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"))
    } catch {
      failed = true
    }
    assert(failed, "invalid hash must throw")
  })

  await step("S8 HISTORY_INVALID blocks restore", async () => {
    await write(path.join(WC, "mark.txt"), "m1")
    const h = await run((s) => s.track([fwd(WC, "mark.txt")]))
    assert(h, "mark hash")

    const projectId = await Instance.provide({
      directory: WC,
      fn: async () => Instance.project.id,
    })
    const fossilDir = path.join(WC, ".opencode", "data", "fossil", projectId)
    await fs.mkdir(fossilDir, { recursive: true })
    const marker = path.join(fossilDir, "HISTORY_INVALID.json")
    await write(
      marker,
      JSON.stringify({
        at: new Date().toISOString(),
        backupPath: "snapshot.fsl.bak.smoke",
        reason: "smoke_test",
      }),
    )

    let blocked = false
    try {
      await run((s) => s.restore(h!))
    } catch {
      blocked = true
    }
    assert(blocked, "HISTORY_INVALID must block restore")
    await fs.rm(marker, { force: true })
  })

  console.log("")
  console.log("=== ALL PASS ===")
  console.log("wc left for inspection:", WC)
  // Instance/fossil locks can keep the process alive; force clean exit.
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
