/**
 * Summary range diffs come from the SNAPSHOT ANCHORS the undo/redo chain already
 * stores — step baselines and patch hashes on message parts — not from a second
 * bookkeeping of tool parts. Three pieces are pinned here:
 *
 * 1. `summaryRangeStartHash` — first anchor inside the range, last one before it.
 * 2. `mergeAnchorDiffs` — anchored stats/status win; tool metadata backfills
 *    snippets and supplies paths the chain has not taken in yet.
 * 3. LIVE: a file changed with NO tool part anywhere (a shell-style write) still
 *    appears in `enrichRange` once the chain has tracked it — the tool-metadata
 *    path cannot see it at all.
 */
import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session/session"
import { SessionSummary, mergeAnchorDiffs, summaryRangeStartHash } from "../../src/session/summary"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Snapshot } from "../../src/snapshot"
import { SnapshotFossil, parseDiffSections } from "../../src/snapshot/fossil"
import { Storage } from "../../src/storage/storage"
import { provideInstance, tmpdir } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const sid = SessionID.make("anchors-live")
const mid = MessageID.make("msg_anchors")
const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }

afterEach(async () => {
  await Instance.disposeAll()
  Bun.gc(true)
})

function patchAnchor(hash: string, id: string): MessageV2.PatchPart {
  return {
    id: PartID.make(`prt_anchor_${id}`),
    sessionID: sid,
    messageID: mid,
    type: "patch",
    hash,
    files: [],
  }
}

function messageWith(parts: MessageV2.Part[]): MessageV2.WithParts[] {
  return [
    {
      info: {
        id: mid,
        sessionID: sid,
        role: "assistant",
        parentID: mid,
        time: { created: 1, completed: 1 },
        agent: "build",
        modelID: ref.modelID,
        providerID: ref.providerID,
        cost: 0,
        mode: "build",
        path: { cwd: "/", root: "/" },
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
      parts,
    },
  ]
}

describe("summaryRangeStartHash", () => {
  test("first anchor inside the range wins", () => {
    const range = messageWith([patchAnchor("aaaa1111", "one"), patchAnchor("bbbb2222", "two")])
    expect(summaryRangeStartHash(range)).toBe("bbbb2222")
  })

  test("falls back to the last anchor before the range", () => {
    const before = messageWith([patchAnchor("cccc3333", "old")])
    expect(summaryRangeStartHash(messageWith([]), before)).toBe("cccc3333")
  })

  test("no anchors anywhere is undefined", () => {
    expect(summaryRangeStartHash(messageWith([]), messageWith([]))).toBeUndefined()
  })
})

describe("mergeAnchorDiffs", () => {
  test("anchored stats win; tool metadata backfills the snippet and adds unknown paths", () => {
    const anchored = [{ file: "C:/w/a.ts", patch: "", additions: 3, deletions: 1, status: "modified" as const }]
    const tools = [
      { file: "C:\\w\\a.ts", patch: "--- a\n+++ b\n+x", additions: 1, deletions: 0, status: "modified" as const },
      { file: "C:/w/new.ts", patch: "--- a\n+++ b\n+y", additions: 1, deletions: 0, status: "added" as const },
    ]
    const merged = mergeAnchorDiffs(anchored, tools)
    expect(merged).toHaveLength(2)
    const anchoredEntry = merged.find((d) => d.file.includes("a.ts"))!
    expect(anchoredEntry.additions).toBe(3)
    expect(anchoredEntry.deletions).toBe(1)
    expect(anchoredEntry.patch).toContain("+x")
    expect(merged.some((d) => d.file.includes("new.ts"))).toBe(true)
  })
})

describe("parseDiffSections", () => {
  test("keeps hunks, drops decoration, skips binaries", () => {
    const text = [
      "ADDED    new.txt",
      "Index: new.txt",
      "==================================================================",
      "--- /dev/null\t",
      "+++ new.txt\t",
      "@@ -0,0 +1,2 @@",
      "+n1",
      "+n2",
      "",
      "Index: binary.bin",
      "==================================================================",
      "--- /dev/null\t",
      "+++ binary.bin\t",
      "cannot compute difference between binary files",
      "",
    ].join("\n")
    const patches = parseDiffSections(text)
    expect(patches.get("new.txt")).toContain("+n1")
    expect(patches.get("new.txt")!.startsWith("--- ")).toBe(true)
    expect(patches.has("binary.bin")).toBe(false)
  })
})

describe("anchored enrichRange", () => {
  test(
    "a file no tool touched still appears — the chain is the source",
    async () => {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(`${dir}/seed.txt`, "seed\n")
        },
      })

      const anchoredLayer = SessionSummary.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            SessionNs.defaultLayer,
            Storage.defaultLayer,
            Bus.layer,
            CrossSpawnSpawner.defaultLayer,
            SnapshotFossil.defaultLayer,
          ),
        ),
      )

      const runSnapshot = <A>(body: (snapshot: Snapshot.Interface) => Effect.Effect<A>) =>
        Effect.gen(function* () {
          const snapshot = yield* Snapshot.Service
          return yield* body(snapshot)
        }).pipe(provideInstance(tmp.path), Effect.provide(SnapshotFossil.defaultLayer))

      const before = await Effect.runPromise(runSnapshot((snapshot) => snapshot.track()))
      expect(before).toBeTruthy()

      // A shell-style write: no write/edit/multiedit part will ever describe it.
      const file = `${tmp.path}/shell-made.txt`
      await Bun.write(file, "made by a shell\n")
      const after = await Effect.runPromise(
        runSnapshot((snapshot) => snapshot.track([file.replaceAll("\\", "/")])),
      )
      expect(after).toBeTruthy()
      expect(after).not.toBe(before)

      const enriched = await Effect.runPromise(
        Effect.gen(function* () {
          const summary = yield* SessionSummary.Service
          return yield* summary.enrichRange({
            sessionID: sid,
            messages: messageWith([patchAnchor(before!, "range-start")]),
            beforeMessages: [],
          })
        }).pipe(provideInstance(tmp.path), Effect.provide(anchoredLayer)),
      )

      const hit = enriched.diffs.find((d) => d.file.replaceAll("\\", "/").endsWith("shell-made.txt"))
      expect(hit).toBeDefined()
      expect(hit!.status).toBe("added")
      expect(hit!.additions).toBeGreaterThan(0)
      expect(hit!.patch).toContain("+made by a shell")
    },
    60_000,
  )
})
