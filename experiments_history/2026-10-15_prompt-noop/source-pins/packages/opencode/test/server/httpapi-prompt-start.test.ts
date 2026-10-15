import { expect, setDefaultTimeout, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { existsSync } from "node:fs"
import { Effect } from "effect"
import { AppRuntime } from "@/effect/app-runtime"
import { Instance } from "@/project/instance"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { MessageID, PartID } from "@/session/schema"
import { ProviderID, ModelID } from "@/provider/schema"
import { InstanceRoutes } from "@/server/routes/instance"
import { tmpdir } from "../fixture/fixture"
import { TestLLMServer } from "../lib/llm-server"
import { mountLiveSession, waitFor } from "../cli/tui/session-live-text-fixture"

setDefaultTimeout(90_000)

test.each([false, true])("ordinary HTTP prompt starts before compact (graph preparation: %s)", async (graph) => {
  const observations: any[] = []
  const frames: Record<string, string> = {}
  const control = path.join(process.env.OPENCODE_TEST_TEMP!, "held-graph-" + process.pid + "-" + graph)
  if (graph) await fs.mkdir(control, { recursive: true })
  await Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      let releaseInference!: () => void
      const inference = new Promise<void>((resolve) => {
        releaseInference = resolve
      })
      if (graph) yield* llm.hold("REGULAR_REPLY", inference)
      for (let i = 0; i < 2; i++)
        yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("REGULAR_REQUEST"), "REGULAR_REPLY")
      yield* llm.textMatch((hit) => JSON.stringify(hit.body).includes("ASYNC_REQUEST"), "ASYNC_REPLY")
      yield* Effect.promise(async () => {
        await using stand = await tmpdir({
          git: true,
          config: {
            snapshot: false,
            formatter: false,
            lsp: false,
            model: "test/test-model",
            ...(graph
              ? {
                  mcp: {
                    codegraph: {
                      type: "local" as const,
                      command: [
                        process.execPath,
                        path.resolve(import.meta.dir, "../mcp/fixture/held-graph-server.ts"),
                        control,
                      ],
                      timeout: 120_000,
                      enabled: true,
                    },
                  },
                }
              : {}),
            provider: {
              test: {
                name: "Local deterministic provider",
                id: "test",
                env: [],
                npm: "@ai-sdk/openai-compatible",
                models: {
                  "test-model": {
                    id: "test-model",
                    name: "Test Model",
                    attachment: false,
                    reasoning: false,
                    temperature: false,
                    tool_call: true,
                    release_date: "2025-01-01",
                    limit: { context: 100_000, output: 10_000 },
                    cost: { input: 0, output: 0 },
                    options: {},
                  },
                },
                options: { apiKey: "test-key", baseURL: llm.url },
              },
            },
          },
        })
        if (graph) await fs.mkdir(path.join(stand.path, ".codegraph"), { recursive: true })
        const app = InstanceRoutes()
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 60,
          fetch: async (request) => await Instance.provide({ directory: stand.path, fn: () => app.fetch(request) }),
        })
        const run = AppRuntime.runPromise
        let fixture: Awaited<ReturnType<typeof mountLiveSession>> | undefined
        try {
          const inProject = <T>(fn: () => Promise<T>) => Instance.provide({ directory: stand.path, fn })
          {
            const sessions = await inProject(() => run(Session.Service.use((s) => Effect.succeed(s))))
            const model = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }
            const seed = async (title: string) => {
              const sid = (await run(sessions.create({ title }))).id
              const msg = await run(
                sessions.updateMessage({
                  id: MessageID.ascending(),
                  sessionID: sid,
                  role: "user",
                  agent: "build_mode",
                  model,
                  time: { created: Date.now() },
                }),
              )
              if (!graph)
                await run(
                  sessions.updatePart({
                    id: PartID.ascending(),
                    sessionID: sid,
                    messageID: msg.id,
                    type: "text",
                    text: "Opening graph context supplied by test fixture",
                    synthetic: true,
                    metadata: { graph_prebuild: true },
                  }),
                )
              return sid
            }
            const regular = await inProject(() => seed("HTTP launch control regular"))
            for (const mode of ["regular", "repeat", "async"] as const) {
              const sid = mode === "async" ? await inProject(() => seed("HTTP launch control async")) : regular
              if (graph && mode === "regular") {
                fixture = await inProject(() =>
                  mountLiveSession({ url: server.url.toString(), directory: stand.path, sid }),
                )
              }
              const responsePending = fetch(
                new URL(`/session/${sid}/${mode === "async" ? "prompt_async" : "message"}`, server.url),
                {
                  method: "POST",
                  headers: { "x-opencode-directory": stand.path, "content-type": "application/json" },
                  body: JSON.stringify({
                    agent: "build_mode",
                    model,
                    parts: [{ type: "text", text: mode === "async" ? "ASYNC_REQUEST" : "REGULAR_REQUEST" }],
                  }),
                  signal: AbortSignal.timeout(45_000),
                },
              )
              if (graph && mode === "regular") {
                const deadline = Date.now() + 10_000
                while (!existsSync(path.join(control, "entered"))) {
                  if (Date.now() > deadline) throw new Error("graph fixture never received preparation request")
                  await Bun.sleep(20)
                }
                const statusResponse = await fetch(new URL("/session/status", server.url), {
                  headers: { "x-opencode-directory": stand.path },
                })
                const status = (await statusResponse.json()) as Record<string, unknown>
                observations.push({
                  phase: "preparing-graph",
                  status: status[sid] ?? null,
                  providerCalls: await Effect.runPromise(llm.calls),
                })
                try {
                  await waitFor(
                    fixture!.ui,
                    () => fixture!.ui.captureCharFrame().includes("preparing code graph"),
                    10_000,
                    "preparation is visible",
                  )
                  frames.preparing = await fixture!.frame()
                } finally {
                  await fs.writeFile(path.join(control, "release"), "continue preparation")
                }
                try {
                  await waitFor(
                    fixture!.ui,
                    () => fixture!.handles.sync.data.message[sid]?.some((m) => m.role === "assistant") ?? false,
                    10_000,
                    "inference began after preparation",
                  )
                  frames.working = await fixture!.frame()
                } finally {
                  releaseInference()
                }
              }
              const response = await responsePending
              const body = await response.text()
              if (mode !== "regular") {
                const deadline = Date.now() + 15_000
                while (Date.now() < deadline) {
                  const rows = await inProject(() => run(sessions.messages({ sessionID: sid })))
                  if (
                    rows.filter((m) => m.info.role === "assistant" && m.info.time.completed).length >=
                    (mode === "repeat" ? 2 : 1)
                  )
                    break
                  await Bun.sleep(20)
                }
              }
              const rows = await inProject(() => run(sessions.messages({ sessionID: sid })))
              observations.push({
                mode,
                status: response.status,
                body,
                messages: rows.map((m) => ({ info: m.info, parts: m.parts })),
              })
              if (fixture && mode === "regular") {
                await waitFor(
                  fixture.ui,
                  () => fixture!.ui.captureCharFrame().includes("REGULAR_REPLY"),
                  10_000,
                  "reply is visible without navigation",
                )
                frames.reply = await fixture.frame()
                fixture.ui.renderer.destroy()
                fixture = undefined
              }
              const statuses = (await (
                await fetch(new URL("/session/status", server.url), { headers: { "x-opencode-directory": stand.path } })
              ).json()) as Record<string, unknown>
              observations.push({ phase: "finished-" + mode, status: statuses[sid] ?? { type: "idle" } })
              await inProject(() => run(SessionPrompt.Service.use((s) => s.cancel(sid))))
            }
            if (graph) {
              await fs.rm(path.join(control, "entered"))
              await fs.rm(path.join(control, "release"))
              const sid = await inProject(() => seed("Cancel graph preparation"))
              const cancelled = await fetch(new URL(`/session/${sid}/prompt_async`, server.url), {
                method: "POST",
                headers: { "x-opencode-directory": stand.path, "content-type": "application/json" },
                body: JSON.stringify({ agent: "build_mode", model, parts: [{ type: "text", text: "CANCEL_REQUEST" }] }),
              })
              expect(cancelled.status).toBe(204)
              const deadline = Date.now() + 10_000
              while (!existsSync(path.join(control, "entered"))) {
                if (Date.now() > deadline) throw new Error("cancellation fixture never entered graph preparation")
                await Bun.sleep(20)
              }
              const callsBefore = await Effect.runPromise(llm.calls)
              await fetch(new URL(`/session/${sid}/abort`, server.url), {
                method: "POST",
                headers: { "x-opencode-directory": stand.path },
              })
              const statuses = (await (
                await fetch(new URL("/session/status", server.url), { headers: { "x-opencode-directory": stand.path } })
              ).json()) as Record<string, unknown>
              observations.push({
                phase: "cancelled",
                status: statuses[sid] ?? { type: "idle" },
                callsBefore,
                callsAfter: await Effect.runPromise(llm.calls),
              })
              await fs.writeFile(path.join(control, "release"), "release cancelled MCP peer")
              const restarted = await fetch(new URL(`/session/${sid}/message`, server.url), {
                method: "POST",
                headers: { "x-opencode-directory": stand.path, "content-type": "application/json" },
                body: JSON.stringify({
                  agent: "build_mode",
                  model,
                  parts: [{ type: "text", text: "REGULAR_REQUEST" }],
                }),
                signal: AbortSignal.timeout(20_000),
              })
              const reply = (await restarted.json()) as { parts: Array<{ type: string; text?: string }> }
              expect(reply.parts.some((p) => p.type === "text" && p.text === "REGULAR_REPLY")).toBe(true)
            }
          }
        } finally {
          fixture?.ui.renderer.destroy()
          server.stop(true)
          await Instance.disposeAll()
        }
      })
      const hits = yield* llm.hits
      observations.push({ providerCalls: hits.length })
    }).pipe(Effect.provide(TestLLMServer.layer)),
  )
  if (process.env.PROMPT_NOOP_EVIDENCE) {
    await fs.mkdir(process.env.PROMPT_NOOP_EVIDENCE, { recursive: true })
    await fs.writeFile(
      path.join(process.env.PROMPT_NOOP_EVIDENCE, graph ? "http-prompt-graph.json" : "http-prompt.json"),
      JSON.stringify({ observations, frames }, null, 2),
    )
  }
  for (const mode of ["regular", "repeat", "async"]) {
    const sample = observations.find((v) => v.mode === mode)
    expect(
      sample.messages.filter(
        (m: any) =>
          m.info.role === "assistant" &&
          m.parts.some(
            (p: any) => p.type === "text" && p.text === (mode === "async" ? "ASYNC_REPLY" : "REGULAR_REPLY"),
          ),
      ).length,
    ).toBe(mode === "repeat" ? 2 : 1)
    expect(observations.find((v) => v.phase === "finished-" + mode).status).toEqual({ type: "idle" })
  }
  expect(observations.at(-1).providerCalls).toBe(graph ? 4 : 3)
  if (graph) {
    const preparing = observations.find((v) => v.phase === "preparing-graph")
    expect(preparing.status).toEqual({ type: "busy", message: "preparing code graph" })
    expect(preparing.providerCalls).toBe(0)
    expect(frames.preparing).toContain("preparing code graph")
    expect(frames.working).toContain("working")
    expect(frames.working).not.toContain("preparing code graph")
    expect(frames.reply).not.toContain("preparing code graph")
    const cancelled = observations.find((v) => v.phase === "cancelled")
    expect(cancelled.status).toEqual({ type: "idle" })
    expect(cancelled.callsAfter).toBe(cancelled.callsBefore)
  }
})
