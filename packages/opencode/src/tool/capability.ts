import { Effect, Schema } from "effect"
import { Tool } from "@/tool/tool"
import { Capability } from "@/capability"

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
  modality: Schema.optional(
    Capability.Modality.annotate({
      description: "Filter results to models supporting a specific output modality: text, image, audio, video, or pdf",
    }),
  ),
})

export const CapabilityTool = Tool.define("capability", Effect.gen(function* () {
  const capability = yield* Capability.Service
  return {
  description: DESCRIPTION,
  parameters: Parameters,
  execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) => Effect.gen(function* () {
    const lookup = yield* capability.lookup(params).pipe(
      Effect.matchEffect({
        onSuccess: (results) => Effect.succeed({ type: "success" as const, results }),
        onFailure: (error) => Effect.succeed({ type: "error" as const, error }),
      }),
    )

    if (lookup.type === "error") {
      return {
        title: `Capability lookup: ${params.task}`,
        metadata: { results: [], criteria: params },
        output: `Capability lookup failed: ${lookup.error.message}`,
      }
    }

    const results = lookup.results

    if (results.length === 0) {
      return {
        title: `Capability lookup: ${params.task}`,
        metadata: { results: [], criteria: params },
        output: `No models found matching "${params.task}". Try broader keywords or check \`models_capabilities.yaml\` for available entries.`,
      }
    }

    const maxModelLen = Math.max(...results.map((r) => r.model_id.length), 8)
    const maxProvLen = Math.max(...results.map((r) => r.provider_id.length), 8)

    const header =
      "Model".padEnd(maxModelLen + 2) +
      "Provider".padEnd(maxProvLen + 2) +
      "Status   Key    Capabilities"
    const sep = "-".repeat(header.length)

    const rows = results.map((r) => {
      const si = r.provenance === "proven" ? "P" : r.provenance === "tested" ? "T" : "-"
      const sl = r.provenance.padEnd(7)
      const ki = r.has_api_key ? "Y" : "N"
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
      "P = proven (tested, working)  T = tested (verified)  - = pending (untested)",
      "Y = API key available         N = no API key found",
      "",
      ...results.filter((r) => r.cost && r.has_api_key).slice(0, 3).map((r) => `  ${r.model_id}: ${r.cost}`),
    ].join("\n")

    return {
      title: `Capability lookup: ${params.task}`,
      metadata: { results, criteria: params },
      output,
    }
  }),
  }
}))
