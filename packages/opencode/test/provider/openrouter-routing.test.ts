import { test, expect, describe } from "bun:test"
import path from "path"

import { ProviderID } from "../../src/provider/schema"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider, openRouterRouting } from "@/provider/provider"
import { Filesystem } from "@/util/filesystem"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"

const ROUTING = { order: ["Z.AI"], allow_fallbacks: false, quantizations: ["fp8"] }

describe("openRouterRouting helper", () => {
  test("returns undefined when options missing", () => {
    expect(openRouterRouting(undefined)).toBeUndefined()
    expect(openRouterRouting({})).toBeUndefined()
  })

  test("returns undefined for null / array / scalar routing", () => {
    expect(openRouterRouting({ routing: null })).toBeUndefined()
    expect(openRouterRouting({ routing: ["Z.AI"] })).toBeUndefined()
    expect(openRouterRouting({ routing: "Z.AI" })).toBeUndefined()
  })

  test("passes routing object through verbatim (openrouter-native keys)", () => {
    expect(openRouterRouting({ routing: ROUTING })).toBe(ROUTING)
    expect(openRouterRouting({ routing: { zdr: true } })).toEqual({ zdr: true })
  })
})

describe("openrouter routing settings → wire", () => {
  // Guards the SDK serialization source: model-level settings.provider is
  // copied into every request body (dist getArgs: `provider: this.settings.provider`).
  test("languageModel(id, {provider}) carries routing into model settings", async () => {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider")
    const sdk = createOpenRouter({ apiKey: "test" })
    const model = sdk.languageModel("z-ai/glm-5.3-flash", { provider: ROUTING })
    expect((model as any).settings?.provider).toEqual(ROUTING)
  })

  test("languageModel without settings has no routing (unchanged default path)", async () => {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider")
    const sdk = createOpenRouter({ apiKey: "test" })
    const model = sdk.languageModel("z-ai/glm-5.3-flash")
    expect((model as any).settings?.provider).toBeUndefined()
  })
})

test("config routing flows into provider options (list)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Filesystem.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            openrouter: {
              options: {
                routing: ROUTING,
              },
            },
          },
        }),
      )
    },
  })
  await Instance.provide({
    directory: tmp.path,
    init: async () => {},
    fn: async () => {
      const providers = await AppRuntime.runPromise(
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          return yield* provider.list()
        }),
      )
      expect(providers[ProviderID.openrouter]).toBeDefined()
      expect(providers[ProviderID.openrouter].options?.routing).toEqual(ROUTING)
    },
  })
})
