import { Effect, Schema } from "effect"
import { Tool } from "@/tool/tool"
import { parse as parseYaml } from "yaml"
import path from "path"
import { Global } from "@opencode-ai/core/global"

const filePath = path.join(Global.Path.config, "models_capabilities.yaml")
const authPath = path.join(Global.Path.config, "auth.json")
const modelsPath = path.join(
  path.dirname(path.dirname(path.dirname(path.dirname(__dirname)))),
  "packages",
  "opencode",
  "models.json",
)

// ─── Sync helpers ────────────────────────────────────────────────────────────

const fs = require("fs")

function readYaml() {
  if (!fs.existsSync(filePath)) return null
  try { return parseYaml(fs.readFileSync(filePath, "utf-8")) } catch { return null }
}

function readAuth(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(authPath, "utf-8")) } catch { return {} }
}

function readModels(): Record<string, { env: string[]; models: Record<string, any> }> {
  const p = path.join(Global.Path.config, "..", "packages", "opencode", "models.json")
  try { return JSON.parse(fs.readFileSync(p, "utf-8")) } catch { return {} }
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

const DESCRIPTION = `Look up which models support a given capability. Cross-references with available API keys and proven/tested status.
Use this tool before:
- Generating images, audio, or video (to find capable models)
- Processing non-text attachments (to find models with vision/audio input)
- Any task requiring model capabilities beyond text output

The results show which models have been tested (proven), which have API keys available, and estimated costs.`

export const Parameters = Schema.Struct({
  task: Schema.String.annotate({
    description:
      "Natural language description of the task. Use keywords like 'generate', 'process', 'read', 'create', 'draw', 'synthesize' to help the tool infer direction.",
    examples: ["generate an image from text", "process this audio file", "read this PDF"],
  }),
  modality: Schema.optional(Schema.String.annotate({
    description: "Filter results to models supporting a specific output modality: image, audio, video, or text",
  })),
})

function buildModalities(
  mods: { input?: string[]; output?: string[] } | undefined,
): { input: Record<string, boolean>; output: Record<string, boolean> } {
  const empty = { text: true, audio: false, image: false, video: false, pdf: false }
  return {
    input: mods?.input ? Object.fromEntries(["text", "audio", "image", "video", "pdf"].map((k) => [k, mods.input!.includes(k)])) : empty,
    output: mods?.output ? Object.fromEntries(["text", "audio", "image", "video", "pdf"].map((k) => [k, mods.output!.includes(k)])) : empty,
  }
}

export const CapabilityTool = Tool.define("capability", Effect.sync(() => ({
  description: DESCRIPTION,
  parameters: Parameters,
  execute: (params: { task: string; modality?: string }, _ctx: Tool.Context) => {
    // Read all data sources
    const yaml = readYaml()
    const auth = readAuth()
    const allModels = readModels()

    // Build lookup map from YAML
    const capMap = new Map<string, { provenance: string; tested_at?: string; notes?: string }>()
    if (yaml?.models) {
      for (const entry of yaml.models) {
        capMap.set(`${entry.provider_id}/${entry.model_id}`, entry)
      }
    }

    const task = params.task.toLowerCase()
    const isGeneration =
      task.includes("generate") || task.includes("create") || task.includes("draw") ||
      task.includes("synthesize") || task.includes("produce")
    const direction = params.modality ? "output" : isGeneration ? "output" : "input"

    interface Result {
      provider_id: string
      model_id: string
      provenance: string
      tested_at?: string
      has_api_key: boolean
      capabilities: string
      cost?: string
      notes?: string
    }

    const results: Result[] = []

    for (const [provID, provData] of Object.entries(allModels)) {
      if (!provData?.models) continue
      const hasProviderKey = provID in auth || (provData.env || []).some((envVar: string) => process.env[envVar])

      for (const [modelID, model] of Object.entries(provData.models)) {
        if (!model) continue
        const mods = buildModalities(model.modalities)
        const modMap = direction === "output" ? mods.output : mods.input

        if (params.modality) {
          if (!modMap[params.modality]) continue
        }

        const entry = capMap.get(`${provID}/${modelID}`)

        const capParts: string[] = []
        if (model.reasoning) capParts.push("reasoning")
        if (model.tool_call !== false) capParts.push("tools")
        if (model.attachment) capParts.push("attachments")
        for (const k of Object.keys(modMap)) {
          if (modMap[k] && k !== "text") capParts.push(k)
        }

        const costStr = model.cost
          ? `$${model.cost.input?.toFixed?.(2) ?? "?"} / $${model.cost.output?.toFixed?.(2) ?? "?"} per 1M tokens`
          : undefined

        results.push({
          provider_id: provID,
          model_id: modelID,
          provenance: entry?.provenance ?? "pending",
          tested_at: entry?.tested_at,
          has_api_key: hasProviderKey,
          capabilities: capParts.length > 0 ? capParts.join(", ") : "text",
          cost: costStr,
          notes: entry?.notes,
        })
      }
    }

    // Sort
    const pOrder: Record<string, number> = { proven: 0, tested: 1, pending: 2 }
    results.sort((a, b) => {
      const pa = pOrder[a.provenance] ?? 2
      const pb = pOrder[b.provenance] ?? 2
      if (pa !== pb) return pa - pb
      if (a.has_api_key !== b.has_api_key) return a.has_api_key ? -1 : 1
      return a.model_id.localeCompare(b.model_id)
    })

    if (results.length === 0) {
      return Effect.succeed({
        title: `Capability lookup: ${params.task}`,
        metadata: { results: [], criteria: params },
        output: `No models found matching "${params.task}". Try broader keywords or check \`models_capabilities.yaml\` for available entries.`,
      })
    }

    const maxModelLen = Math.max(...results.map((r) => r.model_id.length), 8)
    const maxProvLen = Math.max(...results.map((r) => r.provider_id.length), 8)

    const header =
      "Model".padEnd(maxModelLen + 2) +
      "Provider".padEnd(maxProvLen + 2) +
      "Status   Key    Capabilities"
    const sep = "─".repeat(header.length)

    const rows = results.map((r) => {
      const si = r.provenance === "proven" ? "✓" : r.provenance === "tested" ? "○" : "·"
      const sl = r.provenance.padEnd(7)
      const ki = r.has_api_key ? "✓" : "✗"
      return (
        r.model_id.padEnd(maxModelLen + 2) +
        r.provider_id.padEnd(maxProvLen + 2) +
        `${si} ${sl} ${ki}    ${r.capabilities}`
      )
    })

    const output = [
      `Capability lookup: "${params.task}"`,
      `Direction: ${params.modality ?? "auto-detected"} | Found: ${results.length} models`,
      "",
      header,
      sep,
      ...rows,
      sep,
      "",
      "✓ = proven (tested, working)  ○ = tested (verified)  · = pending (untested)",
      "✓ = API key available          ✗ = no API key found",
      "",
      ...results.filter((r) => r.cost && r.has_api_key).slice(0, 3).map((r) => `  ${r.model_id}: ${r.cost}`),
    ].join("\n")

    return Effect.succeed({
      title: `Capability lookup: ${params.task}`,
      metadata: { results, criteria: params },
      output,
    })
  },
})))
