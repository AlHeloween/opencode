import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Env } from "../../src/env"
import { Provider } from "../../src/provider/provider"
import { ProviderID, ModelID } from "../../src/provider/schema"
import { Filesystem } from "../../src/util/filesystem"

const STREAMLAKE_API_KEY = process.env.STREAMLAKE_API_KEY

function skipIfNoKey() {
  if (!STREAMLAKE_API_KEY) {
    console.log("Skipping kat-coder gateway test: STREAMLAKE_API_KEY not set")
    return true
  }
  return false
}

describe("kat-coder-pro-v2 Gateway Pipeline", () => {
  if (skipIfNoKey()) {
    test("skip all tests", () => {})
    return
  }

  test("model resolves from config with full parameters", async () => {
    await using tmp = await tmpdir({ git: true })

    await fs.mkdir(path.join(tmp.path, ".opencode"), { recursive: true })
    await Filesystem.write(
      path.join(tmp.path, ".opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          streamlake: {
            name: "StreamLake",
            env: ["STREAMLAKE_API_KEY"],
            api: "openai",
            models: {
              "kat-coder-pro-v2": {
                id: "kwaipilot/kat-coder-pro-v2",
                name: "Kat Coder Pro V2",
                reasoning: true,
                tool_call: true,
                temperature: true,
                attachment: false,
                baseURL: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints",
                limit: { context: 256000, output: 256000 },
                cost: { input: 0.3, output: 1.2 },
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
        expect(model.capabilities.temperature).toBe(true)
        expect(model.limit.context).toBe(256000)
        expect(model.limit.output).toBe(256000)
        expect(model.cost.input).toBe(0.3)
        expect(model.cost.output).toBe(1.2)
      },
    })
  })

  test("Provider.getModel resolves correctly", async () => {
    await using tmp = await tmpdir({ git: true })

    await fs.mkdir(path.join(tmp.path, ".opencode"), { recursive: true })
    await Filesystem.write(
      path.join(tmp.path, ".opencode", "opencode.json"),
      JSON.stringify({
        provider: {
          streamlake: {
            name: "StreamLake",
            env: ["STREAMLAKE_API_KEY"],
            api: "openai",
            models: {
              "kat-coder-pro-v2": {
                id: "kwaipilot/kat-coder-pro-v2",
                name: "Kat Coder Pro V2",
                reasoning: true,
                tool_call: true,
                baseURL: "https://vanchin.streamlake.ai/api/gateway/v1/endpoints",
                limit: { context: 256000, output: 256000 },
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
        const resolved = await Provider.getModel(ProviderID.make("streamlake"), ModelID.make("kat-coder-pro-v2"))

        expect(resolved.id).toBe(ModelID.make("kat-coder-pro-v2"))
        expect(resolved.capabilities.reasoning).toBe(true)
        expect(resolved.capabilities.toolcall).toBe(true)
        expect(resolved.limit.context).toBe(256000)
      },
    })
  })
})
