/**
 * Live Exact memory path — tool write/edit/multiedit filediffs + CodeGraph.
 * Fossil is rollback only (not used here).
 *
 * Proves:
 * 1) enrichRange reads completed tool metadata.filediff (no Snapshot.diffFull)
 * 2) CodeGraph impact over monorepo file paths when .codegraph is present
 */
import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import path from "path"
import { Effect, Layer } from "effect"
import { Bus } from "../../src/bus"
import { MCP } from "../../src/mcp"
import { hasCodegraphIndex } from "../../src/codegraph/mcp-client"
import { Instance } from "../../src/project/instance"
import { Session as SessionNs } from "../../src/session/session"
import { SessionSummary, collectToolFileDiffs } from "../../src/session/summary"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Storage } from "../../src/storage/storage"
import { provideInstance, provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test") }
const sid = SessionID.make("live-exact")
const mid = MessageID.make("msg_live")
const pid = PartID.make("part_live")

const MONO = path.resolve(import.meta.dir, "../../../..")
const HAS_CODEGRAPH = existsSync(path.join(MONO, ".codegraph"))

const liveSummaryLayer = SessionSummary.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(SessionNs.defaultLayer, Storage.defaultLayer, Bus.layer, CrossSpawnSpawner.defaultLayer),
  ),
)

afterEach(async () => {
  await Instance.disposeAll()
  Bun.gc(true)
})

function toolEditPart(file: string, patch: string, additions: number, deletions: number): MessageV2.ToolPart {
  return {
    id: pid,
    callID: "call_edit",
    tool: "edit",
    type: "tool",
    state: {
      status: "completed",
      output: "ok",
      time: { start: 0, end: 1 },
      input: { filePath: file, oldString: "a", newString: "b" },
      metadata: {
        // The LIVE shape: a list, because one call may change several files. What the historical single-file and
        // `multiedit` shapes are still read for is pinned by the case below, on purpose, so that the
        // compatibility branch carries a reason AND a test instead of surviving as an unexamined hedge.
        filediffs: [{ file, patch, additions, deletions, status: "modified" as const }],
        diff: patch,
      },
      title: path.basename(file),
    },
    sessionID: sid,
    messageID: mid,
  }
}

function asMessages(parts: MessageV2.Part[]): MessageV2.WithParts[] {
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

describe("Exact: tool filediffs for summary (no Fossil)", () => {
  test("collectToolFileDiffs picks write/edit/multiedit filediff", () => {
    const write: MessageV2.ToolPart = {
      id: pid,
      callID: "w1",
      tool: "write",
      type: "tool",
      state: {
        status: "completed",
        output: "ok",
        time: { start: 0, end: 1 },
        input: { filePath: "/a.ts", content: "x" },
        metadata: {
          filediffs: [
            {
              file: "/a.ts",
              patch: "--- a\n+++ b\n+x\n",
              additions: 1,
              deletions: 0,
            },
          ],
        },
        title: "a.ts",
      },
      sessionID: sid,
      messageID: mid,
    }
    const multi: MessageV2.ToolPart = {
      id: pid,
      callID: "m1",
      tool: "multiedit",
      type: "tool",
      state: {
        status: "completed",
        output: "ok",
        time: { start: 0, end: 1 },
        input: { filePath: "/b.ts", edits: [] },
        metadata: {
          results: [
            {
              filediff: {
                file: "/b.ts",
                patch: "--- a\n+++ b\n+y\n",
                additions: 1,
                deletions: 0,
              },
            },
          ],
        },
        title: "b.ts",
      },
      sessionID: sid,
      messageID: mid,
    }
    const diffs = collectToolFileDiffs(asMessages([write, multi]))
    expect(diffs.map((d) => d.file).sort()).toEqual(["/a.ts", "/b.ts"])
    expect(diffs.every((d) => d.patch.includes("+"))).toBe(true)
  })

  test(
    "enrichRange attaches tool patches without Fossil track",
    async () => {
      await Effect.runPromise(
        Effect.scoped(
          provideTmpdirInstance((dir) =>
            Effect.gen(function* () {
              const file = path.join(dir, "live-edit.ts")
              const patch = [
                "--- a/live-edit.ts",
                "+++ b/live-edit.ts",
                "@@ -1 +1,2 @@",
                " export const A = 1",
                "+export const LIVE_MARKER = 2",
              ].join("\n")
              const messages = asMessages([toolEditPart(file, patch, 1, 0)])
              const summary = yield* SessionSummary.Service
              const enriched = yield* summary.enrichRange({
                sessionID: sid,
                messages,
              })
              expect(enriched.diffs.length).toBe(1)
              expect(enriched.diffs[0]!.file).toBe(file)
              expect(enriched.diffs[0]!.patch).toContain("LIVE_MARKER")
              if (!hasCodegraphIndex(dir)) {
                expect(enriched.impact).toBeUndefined()
              }
            }),
          ).pipe(Effect.provide(liveSummaryLayer)),
        ),
      )
    },
    30_000,
  )
})

describe("Exact live: CodeGraph impact on tool file paths", () => {
  test("per-step summary preserves cached graph impact without an MCP runtime", async () => {
    await Effect.runPromise(
      Effect.scoped(
        provideTmpdirInstance((dir) =>
          Effect.gen(function* () {
            const file = path.join(dir, "edited.ts")
            writeFileSync(file, "export function CriticalPathMarker() {}\n")
            mkdirSync(path.join(dir, ".codegraph"))
            const db = new Database(path.join(dir, ".codegraph", "codegraph.db"))
            try {
              db.run("CREATE TABLE nodes (id TEXT, kind TEXT, name TEXT, file_path TEXT, start_line INTEGER)")
              db.run("CREATE TABLE edges (source TEXT, target TEXT, kind TEXT)")
              db.run("INSERT INTO nodes VALUES ('marker', 'function', 'CriticalPathMarker', 'edited.ts', 1)")
            } finally {
              db.close()
            }

            const sessions = yield* SessionNs.Service
            const summary = yield* SessionSummary.Service
            const storage = yield* Storage.Service
            const session = yield* sessions.create({})
            const userID = MessageID.ascending()
            const assistantID = MessageID.ascending()
            yield* sessions.updateMessage({
              id: userID,
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: ref,
            })
            const assistant = asMessages([])[0]!.info
            if (assistant.role !== "assistant") throw new Error("fixture requires an assistant message")
            yield* sessions.updateMessage({
              ...assistant,
              id: assistantID,
              sessionID: session.id,
              parentID: userID,
            })
            const patch = "--- a/edited.ts\n+++ b/edited.ts\n+export function CriticalPathMarker() {}\n"
            yield* sessions.updatePart({
              ...toolEditPart(file, patch, 1, 0),
              id: PartID.ascending(),
              sessionID: session.id,
              messageID: assistantID,
            })

            yield* summary.summarize({ sessionID: session.id, messageID: userID })
            const persisted = MessageV2.get({ sessionID: session.id, messageID: userID }).info
            if (persisted.role !== "user") throw new Error("fixture requires a user message")
            expect(persisted.summary?.diffs?.[0]?.patch).toBe(patch)
            expect(persisted.summary?.impact?.topSymbols).toEqual(["CriticalPathMarker[function]"])
            expect(persisted.summary?.impact?.from).toBe("codegraph-sqlite-cache")
            const diffs = yield* storage.read<{ file: string; patch: string }[]>(["session_diff", session.id])
            expect(diffs).toHaveLength(1)
            expect(diffs[0]?.file).toBe(file)
            expect(diffs[0]?.patch).toBe(patch)
          }),
        ).pipe(Effect.provide(liveSummaryLayer)),
      ),
    )
  }, 30_000)

  test.skipIf(!HAS_CODEGRAPH)(
    "enrichRange CodeGraph impact uses worktree-relative paths from tool filediffs",
    async () => {
      const abs = path.join(MONO, "packages", "opencode", "src", "session", "summary.ts")
      expect(existsSync(abs)).toBe(true)
      const patch = "--- a\n+++ b\n+export const CG_MARKER = 1\n"

      const result = await Effect.runPromise(
        SessionSummary.Service.use((summary) =>
          summary.enrichRange({
            sessionID: sid,
            messages: asMessages([toolEditPart(abs, patch, 1, 0)]),
          }),
        ).pipe(
          Effect.provide(liveSummaryLayer),
          Effect.provide(MCP.defaultLayer),
          provideInstance(MONO),
        ),
      )

      expect(result.diffs.length).toBe(1)
      expect(result.diffs[0]!.patch).toContain("CG_MARKER")
      expect(result.impact).toBeDefined()
      const impact = result.impact!
      const structural =
        impact.topSymbols.length +
        impact.impactedFiles.length +
        Object.keys(impact.symbolCountByKind).length
      expect(structural).toBeGreaterThan(0)
      expect(impact.changedFiles).toBeGreaterThanOrEqual(1)
    },
    120_000,
  )
})
