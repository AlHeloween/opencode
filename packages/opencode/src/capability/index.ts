import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Provider } from "@/provider/provider"
import { Auth } from "@/auth"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

// ─── Schema ──────────────────────────────────────────────────────────────────

export const CapabilityEntry = Schema.Struct({
  provider_id: Schema.String,
  model_id: Schema.String,
  provenance: Schema.Literals(["proven", "tested", "pending"]),
  tested_at: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
})
export type CapabilityEntry = Schema.Schema.Type<typeof CapabilityEntry>

export const CapabilityFile = Schema.Struct({
  version: Schema.Literal(1),
  models: Schema.Array(CapabilityEntry),
})
export type CapabilityFile = Schema.Schema.Type<typeof CapabilityFile>

export const Modality = Schema.Literals(["text", "image", "audio", "video", "pdf"])
export type Modality = Schema.Schema.Type<typeof Modality>

// ─── Lookup types ────────────────────────────────────────────────────────────

export const LookupCriteria = Schema.Struct({
  task: Schema.String,
  modality: Schema.optional(Modality),
})
export type LookupCriteria = Schema.Schema.Type<typeof LookupCriteria>

export const LookupResult = Schema.Struct({
  provider_id: Schema.String,
  model_id: Schema.String,
  provenance: Schema.Literals(["proven", "tested", "pending"]),
  tested_at: Schema.optional(Schema.String),
  has_api_key: Schema.Boolean,
  capabilities: Schema.String,
  cost: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
})
export type LookupResult = Schema.Schema.Type<typeof LookupResult>

// ─── Error ───────────────────────────────────────────────────────────────────

export class CapabilityError extends Schema.TaggedErrorClass<CapabilityError>()("CapabilityError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const filePath = path.join(Global.Path.config, "models_capabilities.yaml")
const decodeCapabilityFile = Schema.decodeUnknownSync(CapabilityFile)

function cacheKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

function capabilityParts(model: Provider.Model, direction: "input" | "output") {
  const modalities = direction === "output" ? model.capabilities.output : model.capabilities.input
  return [
    ...(model.capabilities.reasoning ? ["reasoning"] : []),
    ...(model.capabilities.toolcall ? ["tools"] : []),
    ...(model.capabilities.attachment ? ["attachments"] : []),
    ...Object.entries(modalities).flatMap(([name, supported]) => (supported && name !== "text" ? [name] : [])),
  ]
}

// ─── Service ─────────────────────────────────────────────────────────────────

export interface Interface {
  readonly read: () => Effect.Effect<CapabilityFile, CapabilityError>
  readonly write: (data: CapabilityFile) => Effect.Effect<void, CapabilityError>
  readonly lookup: (criteria: LookupCriteria) => Effect.Effect<LookupResult[], CapabilityError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Capability") {}

const DEFAULT_FILE: CapabilityFile = { version: 1 as const, models: [] }

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service
    const fs = yield* AppFileSystem.Service

    const read = Effect.fn("Capability.read")(function* () {
      if (!(yield* fs.existsSafe(filePath))) return { ...DEFAULT_FILE, models: [] }
      const text = yield* fs
        .readFileString(filePath)
        .pipe(Effect.mapError((cause) => new CapabilityError({ message: "Failed to read capability YAML", cause })))
      return yield* Effect.try({
        try: () => decodeCapabilityFile(parseYaml(text)),
        catch: (cause) => new CapabilityError({ message: "Invalid capability YAML", cause }),
      })
    })

    const write = Effect.fn("Capability.write")(function* (data: CapabilityFile) {
      const yaml = stringifyYaml(data, { lineWidth: 120 })
      yield* fs
        .writeWithDirs(filePath, yaml, 0o600)
        .pipe(Effect.mapError((cause) => new CapabilityError({ message: "Failed to write capability YAML", cause })))
    })

    const lookup = Effect.fn("Capability.lookup")(function* (criteria: LookupCriteria) {
      const file = yield* read()
      const providers = yield* provider.list()
      const allKeys = yield* auth.all().pipe(Effect.orElseSucceed(() => ({} as Record<string, unknown>)))

      const capMap = new Map<string, CapabilityEntry>()
      for (const entry of file.models) capMap.set(cacheKey(entry.provider_id, entry.model_id), entry)

      const task = criteria.task.toLowerCase()
      const isGeneration =
        task.includes("generate") ||
        task.includes("create") ||
        task.includes("draw") ||
        task.includes("synthesize") ||
        task.includes("produce")
      const direction = criteria.modality ? "output" : isGeneration ? "output" : "input"

      const results: LookupResult[] = []

      for (const [provID, provInfo] of Object.entries(providers)) {
        const hasProviderKey =
          Object.prototype.hasOwnProperty.call(allKeys, provID) || provInfo.env.some((envVar) => process.env[envVar])

        for (const model of Object.values(provInfo.models)) {
          const modalities = direction === "output" ? model.capabilities.output : model.capabilities.input

          if (criteria.modality && !modalities[criteria.modality]) continue

          const entry = capMap.get(cacheKey(provID, model.id))
          const parts = capabilityParts(model, direction)

          const costStr = model.cost
            ? `$${model.cost.input.toFixed(2)} / $${model.cost.output.toFixed(2)} per 1M tokens`
            : undefined

          results.push({
            provider_id: provID,
            model_id: model.id,
            provenance: (entry?.provenance ?? "pending") as "proven" | "tested" | "pending",
            tested_at: entry?.tested_at,
            has_api_key: hasProviderKey,
            capabilities: parts.length > 0 ? parts.join(", ") : "text",
            cost: costStr,
            notes: entry?.notes,
          })
        }
      }

      // Sort by verification confidence first, then usable provider auth, then stable identity.
      const pOrder: Record<string, number> = { proven: 0, tested: 1, pending: 2 }
      results.sort((a, b) => {
        const pa = pOrder[a.provenance] ?? 2
        const pb = pOrder[b.provenance] ?? 2
        if (pa !== pb) return pa - pb
        if (a.has_api_key !== b.has_api_key) return a.has_api_key ? -1 : 1
        const providerOrder = a.provider_id.localeCompare(b.provider_id)
        if (providerOrder !== 0) return providerOrder
        return a.model_id.localeCompare(b.model_id)
      })

      return results
    })

    return Service.of({ read, write, lookup })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Provider.defaultLayer),
)

export * as Capability from "."
