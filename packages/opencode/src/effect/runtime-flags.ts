import { Config, Context, Effect, Layer } from "effect"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))

export interface Shape {
  readonly experimentalEventSystem: boolean
  readonly experimentalWebSockets: boolean
  readonly experimentalNativeLlm: boolean
}

export class Service extends Context.Service<Service, Shape>()("@opencode/RuntimeFlags") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const experimentalEventSystem = yield* bool("OPENCODE_EXPERIMENTAL_EVENT_SYSTEM")
    const experimentalWebSockets = yield* bool("OPENCODE_EXPERIMENTAL_WEBSOCKETS")
    const experimentalNativeLlm = yield* bool("OPENCODE_EXPERIMENTAL_NATIVE_LLM")
    return Service.of({ experimentalEventSystem, experimentalWebSockets, experimentalNativeLlm })
  }),
)

export const defaultLayer = layer

export * as RuntimeFlags from "./runtime-flags"
