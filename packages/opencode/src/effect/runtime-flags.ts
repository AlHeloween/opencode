import { Config, Context, Effect, Layer } from "effect"

const bool = (name: string) => Config.boolean(name).pipe(Config.withDefault(false))

export interface Shape {
  readonly experimentalEventSystem: boolean
}

export class Service extends Context.Service<Service, Shape>()("@opencode/RuntimeFlags") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const experimentalEventSystem = yield* bool("OPENCODE_EXPERIMENTAL_EVENT_SYSTEM")
    return Service.of({ experimentalEventSystem })
  }),
)

export const defaultLayer = layer

export * as RuntimeFlags from "./runtime-flags"
