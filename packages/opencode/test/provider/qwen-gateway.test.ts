import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Env } from "../../src/env"
import { Provider } from "../../src/provider/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { SessionID, MessageID } from "../../src/session/schema"
import { readFileSync, existsSync } from "fs"
import { Filesystem } from "../../src/util/filesystem"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"

const STREAMLAKE_API_KEY = process.env.STREAMLAKE_API_KEY

function skipIfNoKey() {
  if (!STREAMLAKE_API_KEY) {
    console.log("Skipping kat-coder gateway test: STREAMLAKE_API_KEY not set")
    return true
  }
  return false
}

function getGatewayLogPath(): string {
  const dataDir = process.env.XDG_DATA_HOME || path.join(process.env.HOME || "", ".local", "share", "opencode")
  return path.join(dataDir, "gateway", "gateway.log")
}

function parseGatewayLog(): Array<Record<string, unknown>> {
  const logPath = getGatewayLogPath()
  if (!existsSync(logPath)) return []
  const content = readFileSync(logPath, "utf-8")
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<Record<string, unknown>>
}

describe("kat-coder-pro-v2 Gateway Pipeline", () => {
  if (skipIfNoKey()) {
    test("skip all tests", () => {})
    return
  }

  test("model resolves from config with cache fallback parameters", async () => {
    await using tmp = await tmpdir({ git: true })

    await Filesystem.write(
      path.join(tmp.path, "gateway.json"),
      JSON.stringify({
        providers: {
          streamlake: {
            name: "StreamLake",
            env: ["STREAMLAKE_API_KEY"],
            api: "openai",
            models: {
              "kat-coder-pro-v2": {
                baseURL: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints",
                gateway: { rateLimit: { tpm: 300000, rpm: 5 } },
              },
            },
            options: { timeout: 300000, chunkTimeout: 30000 },
          },
        },
        gateway: { enabled: true, preferH2: false },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("STREAMLAKE_API_KEY", STREAMLAKE_API_KEY!)
      },
      fn: async () => {
        const providers = await Provider.list()
        const providerID = ProviderID.make("streamlake")
        const modelID = ModelID.make("kat-coder-pro-v2")

        expect(providers[providerID]).toBeDefined()
        expect(providers[providerID].models[modelID]).toBeDefined()

        const model = providers[providerID].models[modelID]
        expect(model.capabilities.reasoning).toBe(true)
        expect(model.capabilities.toolcall).toBe(true)
        expect(model.limit.context).toBe(256000)
        expect(model.limit.output).toBe(80000)
      },
    })
  })

  test("gateway metrics recorded after LLM request", async () => {
    await using tmp = await tmpdir({ git: true })

    await Filesystem.write(
      path.join(tmp.path, "gateway.json"),
      JSON.stringify({
        providers: {
          streamlake: {
            name: "StreamLake",
            env: ["STREAMLAKE_API_KEY"],
            api: "openai",
            models: {
              "kat-coder-pro-v2": {
                baseURL: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints",
                gateway: { rateLimit: { tpm: 300000, rpm: 5 } },
              },
            },
            options: { timeout: 300000, chunkTimeout: 30000 },
          },
        },
        gateway: { enabled: true, preferH2: false },
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("STREAMLAKE_API_KEY", STREAMLAKE_API_KEY!)
      },
      fn: async () => {
        const { LLM } = await import("../../src/session/llm")
        const resolved = await Provider.getModel(ProviderID.make("streamlake"), ModelID.make("kat-coder-pro-v2"))

        const sessionID = SessionID.make("test-session-1")
        const agent: Agent.Info = {
          name: "test",
          mode: "primary",
          options: {},
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        }

        const userMsg: MessageV2.User = {
          id: MessageID.make("user-1"),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID: ProviderID.make("streamlake"), modelID: resolved.id },
        }

        const stream = await LLM.stream({
          user: userMsg,
          sessionID,
          model: resolved,
          agent,
          system: [],
          messages: [{ role: "user", content: "Say test and nothing else." }],
          tools: {},
          abort: new AbortController().signal,
        })

        let text = ""
        for await (const event of stream.fullStream) {
          if (event.type === "text-delta") {
            text += event.text
          }
        }

        expect(text.length).toBeGreaterThan(0)

        const logs = parseGatewayLog()
        const katCoderLogs = logs.filter(
          (entry) => entry.provider === "streamlake" && entry.model === "kat-coder-pro-v2",
        )

        expect(katCoderLogs.length).toBeGreaterThan(0)

        const requestEnd = katCoderLogs.find((entry) => entry.event === "gateway.request.end")
        expect(requestEnd).toBeDefined()
        expect(requestEnd!.status).toBe(200)
      },
    })
  }, 90000)
})
