import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import * as InstanceState from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { Effect, Layer, Schema } from "effect"
import path from "path"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"

const root = "/config"

const RuleState = Schema.Struct({
  name: Schema.String,
  enabled: Schema.Boolean,
}).annotate({ identifier: "RuleState" })

export const ConfigApi = HttpApi.make("config")
  .add(
    HttpApiGroup.make("config")
      .add(
        HttpApiEndpoint.get("get", root, {
          success: Config.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.get",
            summary: "Get configuration",
            description: "Retrieve the current OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.patch("update", root, {
          payload: Config.Info,
          success: Config.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.update",
            summary: "Update configuration",
            description: "Update OpenCode configuration settings and preferences.",
          }),
        ),
        HttpApiEndpoint.get("providers", `${root}/providers`, {
          success: Provider.ConfigProvidersResult,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.providers",
            summary: "List config providers",
            description: "Get a list of all configured AI providers and their default models.",
          }),
        ),
        HttpApiEndpoint.get("rules", `${root}/rules`, {
          success: Schema.Array(RuleState),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "config.rules",
            summary: "List rule files",
            description: "Rule files in .opencode/rules with their enabled state (config.rules map).",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "config",
          description: "Experimental HttpApi config routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const configHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const providerSvc = yield* Provider.Service
    const configSvc = yield* Config.Service

    const get = Effect.fn("ConfigHttpApi.get")(function* () {
      return yield* configSvc.get()
    })

    const update = Effect.fn("ConfigHttpApi.update")(function* (ctx) {
      // Decoded HTTP payload is the readonly schema type; the service contract
      // takes DeepMutable Info (config.ts:423 pattern, same as /global PATCH).
      yield* configSvc.update(ctx.payload as Config.Info, { dispose: false })
      const instance = yield* InstanceRef
      yield* Effect.promise(() => Instance.dispose(instance))
      return ctx.payload
    })

    const providers = Effect.fn("ConfigHttpApi.providers")(function* () {
      const providers = yield* providerSvc.list()
      return {
        providers: Object.values(providers),
        default: Provider.defaultModelIDs(providers),
      }
    })

    const rules = Effect.fn("ConfigHttpApi.rules")(function* () {
      const cfg = yield* configSvc.get()
      const ctx = yield* InstanceState.context
      const fsys = yield* AppFileSystem.Service
      const rulesDir = path.join(ctx.worktree, ".opencode", "rules")
      const matches = yield* fsys.glob("**/*", { cwd: rulesDir, absolute: true, include: "file" }).pipe(
        Effect.catch(() => Effect.succeed([] as string[])),
      )
      const rulesCfg = cfg.rules ?? {}
      return matches
        .filter((f) => [".mdc", ".md"].some((ext) => f.endsWith(ext)))
        .sort()
        .map((f) => ({ name: path.basename(f), enabled: rulesCfg[path.basename(f)] !== false }))
    })

    return HttpApiBuilder.group(ConfigApi, "config", (handlers) =>
      handlers.handle("get", get).handle("update", update).handle("providers", providers).handle("rules", rules),
    )
  }),
).pipe(
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
)
