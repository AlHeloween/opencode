import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageID, type SessionID } from "@/session/schema"
import { Session } from "@/session/session"
import { HYBRID_TIMEOUT_MS, executeHybridSearch, resolveSearchSource, UniversalSearchTool } from "@/tool/universalsearch"
import * as Tool from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

setDefaultTimeout(30_000)

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Provider.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    AppFileSystem.defaultLayer,
  ),
)

afterEach(async () => {
  await Instance.disposeAll()
})

type AskInput = Parameters<Tool.Context["ask"]>[0]

function context(
  sessionID: SessionID,
  messageID: MessageID,
  agentInfo: Agent.Info | undefined,
  ask: (req: AskInput) => Effect.Effect<void>,
) {
  return {
    sessionID,
    messageID,
    agent: agentInfo?.name ?? "build",
    agentInfo,
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask,
  } satisfies Tool.Context
}

describe("tool.universalsearch", () => {
  test("omitted source defaults to hybrid", () => {
    expect(resolveSearchSource({})).toBe("hybrid")
    expect(resolveSearchSource({ source: "code" })).toBe("code")
    expect(resolveSearchSource({ source: "agent" })).toBe("agent")
    expect(resolveSearchSource({ source: "web" })).toBe("web")
  })

  // t46: the hybrid path gets its own client timeout, derived from measurement
  // (plan 2026-10-15_universalsearch-hybrid-default): the service's code leg streams
  // Sourcegraph with a 50 s upstream cap and the web leg measured up to 18.9 s, so
  // the composed worst case is ~69 s; a healthy hybrid call measured 55.3 s and an
  // independent case 64 s — both above the old shared 60 s default, which aborted
  // them. The export must exist and clear the measured maximum.
  test("hybrid timeout clears the measured maximum", () => {
    expect(HYBRID_TIMEOUT_MS).toBeGreaterThan(55_300)
  })

  // The web-only executor gate used to refuse researcher_agent before the
  // permission stage. Reaching `ask` with source "code"/"hybrid"/"agent" proves
  // the gate is gone; dying inside ask keeps the test off the network.
  for (const source of ["code", "hybrid", "agent"] as const) {
    it.live(`researcher_agent with source "${source}" is no longer refused`, () =>
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const agents = yield* Agent.Service
          const researcher = yield* agents.get("researcher_agent")
          expect(researcher).toBeDefined()
          const chat = yield* sessions.create({})
          const user = yield* sessions.updateMessage({
            id: MessageID.ascending(),
            role: "user",
            sessionID: chat.id,
            agent: "researcher_agent",
            model: ref,
            time: { created: Date.now() },
          })

          const search = yield* (yield* UniversalSearchTool).init()
          const asks: AskInput[] = []
          const outcome = yield* Effect.exit(
            search.execute(
              { query: "kv cache", source },
              context(chat.id, user.id, researcher, (req) => {
                asks.push(req)
                return Effect.die(new Permission.RejectedError())
              }),
            ),
          )

          expect(Exit.isFailure(outcome)).toBe(true)
          expect(asks.map((req) => req.permission)).toEqual(["universalsearch"])
          expect(asks[0]?.metadata?.["source"]).toBe(source)
        }),
      ),
    )
  }

  // t56: the hybrid formatter must show what the service actually returns. The
  // service (universal-search/src/hybrid.rs) sets `source` only to
  // "sourcegraph" or "web" — "local" is never produced — and stamps sourcegraph
  // hits with rung "Inferred" and a source_stamp whose scope is "metadata".
  // Today's formatter labels every hit [Sourcegraph] (web hits included), drops
  // title/description/rung/stamp, never fills metadata.source_stamps, and keeps
  // a stale header. These tests drive the real executor against a fake /hybrid
  // endpoint carrying the service's real shape.
  describe("tool.universalsearch hybrid output", () => {
    function fakeService(results: unknown[], extra: Record<string, unknown> = {}) {
      return Bun.serve({
        port: 0,
        fetch: (req) => {
          if (new URL(req.url).pathname === "/hybrid") {
            return Response.json({
              query: "q",
              mode: "hybrid",
              result_count: results.length,
              sourcegraph_results: results.filter((r: any) => r.source === "sourcegraph").length,
              web_results: results.filter((r: any) => r.source === "web").length,
              results,
              ...extra,
            })
          }
          if (new URL(req.url).pathname === "/health") {
            return new Response("ok")
          }
          return new Response("not found", { status: 404 })
        },
      })
    }

    function execHybrid(baseUrl: string) {
      return Effect.runPromise(executeHybridSearch(baseUrl.replace(/\/$/, ""), { query: "q", limit: 10 }))
    }

    const sourcegraphHit = {
      source: "sourcegraph",
      rung: "Inferred",
      file: "src/auth/session.ts",
      repository: "github.com/example/repo",
      line: 42,
      preview: "const session = createSession()",
      url: "https://github.com/example/repo/blob/main/src/auth/session.ts#L42",
      source_stamp: {
        authority_class: "source_code",
        url_provenance: "github.com/example/repo",
        content_hash: "a".repeat(64),
        scope: "metadata",
      },
    }

    const webHit = {
      source: "web",
      rung: "Guess",
      title: "Effect docs: services",
      description: "How to build Effect services",
      url: "https://effect.website/docs/requirements-services",
    }

    test("labels a web hit [Web] and shows its title, description and rung", async () => {
      using server = fakeService([webHit])
      const result = await execHybrid(server.url.toString())
      expect(result.output).toContain("[Web]")
      expect(result.output).not.toContain("[Sourcegraph]")
      expect(result.output).toContain("Effect docs: services")
      expect(result.output).toContain("How to build Effect services")
      expect(result.output).toContain("rung=Guess")
      expect(result.metadata.resultsCount).toBe(1)
    })

    test("labels a sourcegraph hit [Code · Sourcegraph] and prints rung, stamp with scope", async () => {
      using server = fakeService([sourcegraphHit])
      const result = await execHybrid(server.url.toString())
      expect(result.output).toContain("[Code · Sourcegraph]")
      expect(result.output).toContain("rung=Inferred")
      expect(result.output).toContain("scope=metadata")
      expect(result.output).toContain("authority_class=source_code")
      expect(result.output).toContain("content_hash=" + "a".repeat(64))
      expect(result.output).toContain("**Repository:** github.com/example/repo")
      expect(result.output).toContain("Line 42:")
      expect(result.metadata.source_stamps).toHaveLength(1)
      expect(result.metadata.source_stamps?.[0].scope).toBe("metadata")
    })

    test("prints per-leg counts and a current header", async () => {
      using server = fakeService([webHit, sourcegraphHit])
      const result = await execHybrid(server.url.toString())
      expect(result.output).toContain("sourcegraph_results: 1")
      expect(result.output).toContain("web_results: 1")
      expect(result.output).not.toContain("local code search (first)")
    })

    test("a zero on the code leg is visible", async () => {
      using server = fakeService([webHit])
      const result = await execHybrid(server.url.toString())
      expect(result.output).toContain("sourcegraph_results: 0")
      expect(result.output).toContain("web_results: 1")
    })
  })
})
