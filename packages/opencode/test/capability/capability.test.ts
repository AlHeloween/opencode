import { beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect, Exit, Layer, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Capability } from "@/capability"
import { Permission } from "@/permission"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { CapabilityTool, Parameters } from "@/tool/capability"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { MessageID, SessionID } from "@/session/schema"
import { ProviderTest } from "../fake/provider"

const capabilityPath = path.join(Global.Path.config, "models_capabilities.yaml")

const textModel = ProviderTest.model({
  id: ModelID.make("text-model"),
  cost: { input: 1, output: 2, cache: { read: 0.1, write: 0.2 } },
})

const imageModel = ProviderTest.model({
  id: ModelID.make("image-model"),
  cost: { input: 3, output: 4, cache: { read: 0.3, write: 0.4 } },
  capabilities: {
    ...textModel.capabilities,
    reasoning: true,
    output: { ...textModel.capabilities.output, image: true },
  },
})

const visionModel = ProviderTest.model({
  id: ModelID.make("vision-model"),
  providerID: ProviderID.make("anthropic"),
  capabilities: {
    ...textModel.capabilities,
    attachment: true,
    input: { ...textModel.capabilities.input, image: true, pdf: true },
  },
})

const providers: Record<ProviderID, Provider.Info> = {
  [ProviderID.make("openai")]: ProviderTest.info(
    {
      id: ProviderID.make("openai"),
      env: [],
      models: { [textModel.id]: textModel, [imageModel.id]: imageModel },
    },
    textModel,
  ),
  [ProviderID.make("anthropic")]: ProviderTest.info(
    {
      id: ProviderID.make("anthropic"),
      env: [],
      models: { [visionModel.id]: visionModel },
    },
    visionModel,
  ),
}

function authLayer(providerIDs: string[] = []) {
  const entries = Object.fromEntries(
    providerIDs.map((providerID) => [providerID, new Auth.Api({ type: "api", key: "" })]),
  ) as Record<string, Auth.Info>
  return Layer.succeed(
    Auth.Service,
    Auth.Service.of({
      all: Effect.fn("CapabilityTest.Auth.all")(() => Effect.succeed(entries)),
      get: Effect.fn("CapabilityTest.Auth.get")((providerID) => Effect.succeed(entries[providerID])),
      set: Effect.fn("CapabilityTest.Auth.set")(() => Effect.void),
      remove: Effect.fn("CapabilityTest.Auth.remove")(() => Effect.void),
    }),
  )
}

function providerLayer(input: Record<ProviderID, Provider.Info> = providers) {
  return Layer.succeed(
    Provider.Service,
    Provider.Service.of({
      list: Effect.fn("CapabilityTest.Provider.list")(() => Effect.succeed(input)),
      getProvider: Effect.fn("CapabilityTest.Provider.getProvider")((providerID) =>
        input[providerID] ? Effect.succeed(input[providerID]) : Effect.die(new Error(`Unknown provider ${providerID}`)),
      ),
      getModel: Effect.fn("CapabilityTest.Provider.getModel")((providerID, modelID) => {
        const model = input[providerID]?.models[modelID]
        return model ? Effect.succeed(model) : Effect.die(new Error(`Unknown model ${providerID}/${modelID}`))
      }),
      getLanguage: Effect.fn("CapabilityTest.Provider.getLanguage")(() =>
        Effect.die(new Error("Capability tests do not load language models")),
      ),
      closest: Effect.fn("CapabilityTest.Provider.closest")(() => Effect.succeed(undefined)),
      getSmallModel: Effect.fn("CapabilityTest.Provider.getSmallModel")(() => Effect.succeed(undefined)),
      defaultModel: Effect.fn("CapabilityTest.Provider.defaultModel")(() =>
        Effect.succeed({ providerID: ProviderID.make("openai"), modelID: ModelID.make("text-model") }),
      ),
    }),
  )
}

function agentLayer() {
  const agent: Agent.Info = {
    name: "build",
    mode: "primary",
    native: true,
    permission: Permission.fromConfig({ "*": "allow" }),
    options: {},
  }
  return Layer.succeed(
    Agent.Service,
    Agent.Service.of({
      get: Effect.fn("CapabilityTest.Agent.get")(() => Effect.succeed(agent)),
      list: Effect.fn("CapabilityTest.Agent.list")(() => Effect.succeed([agent])),
      defaultAgent: Effect.fn("CapabilityTest.Agent.defaultAgent")(() => Effect.succeed("build")),
      generate: Effect.fn("CapabilityTest.Agent.generate")(() =>
        Effect.succeed({
          identifier: "build",
          whenToUse: "test",
          systemPrompt: "test",
        }),
      ),
    }),
  )
}

function provideCapability<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options: { authProviders?: string[]; providerRows?: Record<ProviderID, Provider.Info> } = {},
) {
  return effect.pipe(
    Effect.provide(Capability.layer),
    Effect.provide(AppFileSystem.defaultLayer),
    Effect.provide(providerLayer(options.providerRows)),
    Effect.provide(authLayer(options.authProviders)),
  )
}

function provideTool<A, E, R>(effect: Effect.Effect<A, E, R>, authProviders: string[] = []) {
  return provideCapability(effect, { authProviders }).pipe(
    Effect.provide(Truncate.defaultLayer),
    Effect.provide(agentLayer()),
  )
}

const ctx: Tool.Context = {
  sessionID: SessionID.descending(),
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata() {
    return Effect.void
  },
  ask() {
    return Effect.void
  },
}

beforeEach(async () => {
  await fs.rm(capabilityPath, { force: true })
})

describe("Capability.Service", () => {
  test("returns an empty file when capability YAML is absent", async () => {
    const result = await Effect.runPromise(provideCapability(Capability.Service.use((service) => service.read())))
    expect(result).toEqual({ version: 1, models: [] })
  })

  test("decodes valid capability YAML", async () => {
    await Bun.write(
      capabilityPath,
      [
        "version: 1",
        "models:",
        "  - provider_id: openai",
        "    model_id: image-model",
        "    provenance: proven",
        "    tested_at: '2026-06-23T00:00:00Z'",
        "    notes: image generation verified",
        "",
      ].join("\n"),
    )
    const result = await Effect.runPromise(provideCapability(Capability.Service.use((service) => service.read())))
    expect(result.models).toEqual([
      {
        provider_id: "openai",
        model_id: "image-model",
        provenance: "proven",
        tested_at: "2026-06-23T00:00:00Z",
        notes: "image generation verified",
      },
    ])
  })

  test("fails malformed capability YAML instead of silently ignoring it", async () => {
    await Bun.write(capabilityPath, "version: 1\nmodels:\n  - provider_id: openai\n    model_id: [bad]\n")
    const exit = await Effect.runPromiseExit(provideCapability(Capability.Service.use((service) => service.read())))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("filters by modality and annotates auth availability", async () => {
    await Bun.write(
      capabilityPath,
      [
        "version: 1",
        "models:",
        "  - provider_id: openai",
        "    model_id: image-model",
        "    provenance: proven",
        "",
      ].join("\n"),
    )
    const result = await Effect.runPromise(
      provideCapability(Capability.Service.use((service) => service.lookup({ task: "generate an image", modality: "image" })), {
        authProviders: ["openai"],
      }),
    )
    expect(result.map((item) => item.model_id)).toEqual(["image-model"])
    expect(result[0]).toMatchObject({
      provider_id: "openai",
      provenance: "proven",
      has_api_key: true,
    })
    expect(result[0]?.capabilities).toContain("image")
  })

  test("sorts by provenance, auth availability, provider, and model", async () => {
    await Bun.write(
      capabilityPath,
      [
        "version: 1",
        "models:",
        "  - provider_id: openai",
        "    model_id: text-model",
        "    provenance: tested",
        "  - provider_id: anthropic",
        "    model_id: vision-model",
        "    provenance: proven",
        "",
      ].join("\n"),
    )
    const result = await Effect.runPromise(
      provideCapability(Capability.Service.use((service) => service.lookup({ task: "process image", modality: "text" })), {
        authProviders: ["openai"],
      }),
    )
    expect(result.map((item) => `${item.provider_id}/${item.model_id}:${item.provenance}:${item.has_api_key}`)).toEqual([
      "anthropic/vision-model:proven:false",
      "openai/text-model:tested:true",
      "openai/image-model:pending:true",
    ])
  })
})

describe("CapabilityTool", () => {
  test("delegates lookup to Capability.Service and returns formatted output", async () => {
    await Bun.write(
      capabilityPath,
      [
        "version: 1",
        "models:",
        "  - provider_id: openai",
        "    model_id: image-model",
        "    provenance: proven",
        "",
      ].join("\n"),
    )
    const info = await Effect.runPromise(provideTool(CapabilityTool, ["openai"]))
    const tool = await Effect.runPromise(info.init())
    const result = await Effect.runPromise(tool.execute({ task: "generate image", modality: "image" }, ctx))

    expect(result.title).toBe("Capability lookup: generate image")
    expect(result.output).toContain("image-model")
    expect(result.output).toContain("P proven")
    expect(result.metadata.results).toHaveLength(1)
  })

  test("rejects unsupported modality values at the parameter schema", () => {
    expect(() => Schema.decodeUnknownSync(Parameters)({ task: "generate", modality: "spreadsheet" })).toThrow()
  })
})
