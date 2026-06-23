import path from "path"
import { Effect, Layer, Schema, Context } from "effect"
import { Global } from "@opencode-ai/core/global"
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

// ─── Lookup types ────────────────────────────────────────────────────────────

export const LookupCriteria = Schema.Struct({
  task: Schema.String,
  modality: Schema.optional(Schema.Literals(["image", "audio", "video", "text"])),
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

function readYamlSync(): CapabilityFile | null {
  const fs = require("fs")
  if (!fs.existsSync(filePath)) return null
  try {
    const text = fs.readFileSync(filePath, "utf-8")
    const parsed = parseYaml(text)
    return parsed as CapabilityFile
  } catch {
    return null
  }
}

function writeYamlSync(data: CapabilityFile): void {
  const fs = require("fs")
  const yaml = stringifyYaml(data, { lineWidth: 120 })
  fs.writeFileSync(filePath, yaml, { mode: 0o600 })
}

function cacheKey(provider: string, model: string): string {
  return `${provider}/${model}`
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

    const read = Effect.fn("Capability.read")(function* () {
      const result = yield* Effect.try({
        try: () => readYamlSync() ?? { ...DEFAULT_FILE },
        catch: (cause) => new CapabilityError({ message: "Failed to read capability YAML", cause }),
      })
      return result
    })

    const write = Effect.fn("Capability.write")(function* (data: CapabilityFile) {
      yield* Effect.try({
        try: () => writeYamlSync(data),
        catch: (cause) => new CapabilityError({ message: "Failed to write capability YAML", cause }),
      })
    })

    const lookup = Effect.fn("Capability.lookup")(function* (criteria: LookupCriteria) {
      const file = yield* read()
      const providers = yield* provider.list()
      const allKeys = yield* auth.all().pipe(Effect.orElseSucceed(() => ({} as Record<string, unknown>)))

      // Build capability lookup map from YAML
      const capMap = new Map<string, CapabilityEntry>()
      for (const entry of file.models) {
        capMap.set(cacheKey(entry.provider_id, entry.model_id), entry)
      }

      // Determine direction from task keywords
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
        const hasProviderKey = provID in allKeys || provInfo.env.some((envVar) => process.env[envVar])

        for (const model of Object.values(provInfo.models)) {
          const caps = model.capabilities
          const mods = direction === "output" ? caps.output : caps.input

          // Filter by modality if specified
          if (criteria.modality) {
            const m = criteria.modality
            const modMap = mods as unknown as Record<string, boolean>
            if (!modMap[m]) continue
          }

          const entry = capMap.get(cacheKey(provID, model.id))

          // Build human-readable capabilities string
          const capParts: string[] = []
          if (caps.reasoning) capParts.push("reasoning")
          if (caps.toolcall) capParts.push("tools")
          if (caps.attachment) capParts.push("attachments")
          const modMap = mods as unknown as Record<string, boolean>
          for (const k of Object.keys(modMap)) {
            if (modMap[k] && k !== "text") capParts.push(k)
          }

          const costStr = model.cost
            ? `$${model.cost.input.toFixed(2)} / $${model.cost.output.toFixed(2)} per 1M tokens`
            : undefined

          results.push({
            provider_id: provID,
            model_id: model.id,
            provenance: (entry?.provenance ?? "pending") as "proven" | "tested" | "pending",
            tested_at: entry?.tested_at,
            has_api_key: hasProviderKey,
            capabilities: capParts.length > 0 ? capParts.join(", ") : "text",
            cost: costStr,
            notes: entry?.notes,
          })
        }
      }

      // Sort: proven → tested → pending, then has_api_key first, then alphabetically
      const pOrder: Record<string, number> = { proven: 0, tested: 1, pending: 2 }
      results.sort((a, b) => {
        const pa = pOrder[a.provenance] ?? 2
        const pb = pOrder[b.provenance] ?? 2
        if (pa !== pb) return pa - pb
        if (a.has_api_key !== b.has_api_key) return a.has_api_key ? -1 : 1
        return a.model_id.localeCompare(b.model_id)
      })

      return results
    })

    return Service.of({ read, write, lookup })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Auth.defaultLayer))

export * as Capability from "."
