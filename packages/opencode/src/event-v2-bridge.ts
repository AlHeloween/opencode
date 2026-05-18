// V2 event bridge: routes core EventV2 events to the legacy Bus system.
// Dual-write layer for incremental migration — gated by RuntimeFlags.experimentalEventSystem.
import { Bus as ProjectBus } from "@/bus"
import { EventV2 } from "@opencode-ai/core/event"
import "@opencode-ai/core/session-event"
import { Context, Effect, Layer } from "effect"

export class Service extends Context.Service<Service, EventV2.Interface>()("@opencode/EventV2Bridge") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const bus = yield* ProjectBus.Service

    const unsubscribe = yield* events.sync((event) => {
      const definition = EventV2.registry.get(event.type)
      if (!definition) return Effect.void

      // Route to legacy bus — publish event data as bus properties
      return bus.publish(
        { type: definition.type, properties: definition.data },
        event.data as Record<string, unknown>,
      )
    })

    yield* Effect.addFinalizer(() => unsubscribe)
    return Service.of(events)
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provideMerge(EventV2.defaultLayer),
  Layer.provide(ProjectBus.defaultLayer),
)

export * as EventV2Bridge from "./event-v2-bridge"
