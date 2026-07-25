import { Effect, Schema } from "effect"
import { Tool } from "@/tool/tool"
import { Capability } from "@/capability"
import { Provider } from "@/provider/provider"

// ─── Tool Definition ─────────────────────────────────────────────────────────

const DESCRIPTION = `Look up which models support a given capability, or list all available models with limits and costs.

Use this tool before:
- Generating images, audio, or video (to find capable models)
- Processing non-text attachments (to find models with vision/audio input)
- Any task requiring model capabilities beyond text output
- Choosing the right model for ai-call based on output limits and cost

## Modes

### Capability lookup (default)
Filter models by what they can DO. Provide a task description and optional modality.

### List all models
Set list_all: true to dump every connected model with output limits, costs, and input modalities.
Optionally filter by min_output_tokens to find models with sufficient output window.`

export const Parameters = Schema.Struct({
  task: Schema.optional(Schema.String).annotate({
    description:
      "Natural language description of the task. Use keywords like 'generate', 'process', 'read', 'create', 'draw', 'synthesize' to help the tool infer direction.",
  }),
  modality: Schema.optional(
    Capability.Modality.annotate({
      description: "Filter results to models supporting a specific output modality: text, image, audio, video, or pdf",
    }),
  ),
  list_all: Schema.optional(Schema.Boolean).annotate({
    description: "List ALL available models with their output limits and costs (ignores task/modality filters)",
  }),
  min_output_tokens: Schema.optional(Schema.Number).annotate({
    description: "Minimum output token limit (e.g., 128000 for 128K models). Useful when list_all is true or for finding large-context models",
  }),
})

type CapabilityMeta = {
  pattern?: string
  results: number
  criteria?: Record<string, unknown>
}

export const CapabilityTool = Tool.define("capability", Effect.gen(function* () {
  const capability = yield* Capability.Service
  const provider = yield* Provider.Service

  return {
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult<CapabilityMeta>> =>
      Effect.gen(function* () {
        // ── List-all mode ──
        if (params.list_all) {
          const providers = yield* provider.list()
          type Row = {
            provider_id: string
            model_id: string
            status: string
            output_limit: number
            cost_input: number
            cost_output: number
            input_mods: string
          }
          const all: Row[] = []

          for (const [provID, provInfo] of Object.entries(providers)) {
            for (const model of Object.values(provInfo.models)) {
              const outputLimit = model.limit?.output ?? 0
              if (params.min_output_tokens && outputLimit < params.min_output_tokens) continue

              const inputMods = Object.entries(model.capabilities.input)
                .filter(([, v]) => v)
                .map(([k]) => k)
                .join(",") || "text"

              all.push({
                provider_id: provID,
                model_id: model.id,
                status: model.status ?? "active",
                output_limit: outputLimit,
                cost_input: model.cost?.input ?? 0,
                cost_output: model.cost?.output ?? 0,
                input_mods: inputMods,
              })
            }
          }

          // Sort: highest output limit first
          all.sort((a, b) => b.output_limit - a.output_limit)

          if (all.length === 0) {
            const minMsg = params.min_output_tokens
              ? ` with min_output_tokens >= ${params.min_output_tokens}`
              : ""
            return {
              title: "Model list",
              metadata: { results: 0, criteria: { ...params } },
              output: `No models found${minMsg}.`,
            }
          }

          const maxProv = Math.max(...all.map((r) => r.provider_id.length), 8)
          const maxModel = Math.max(...all.map((r) => r.model_id.length), 8)

          const fmt = (n: number): string => {
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
            if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
            return String(n)
          }

          const header =
            "Provider".padEnd(maxProv + 2) +
            "Model".padEnd(maxModel + 2) +
            "Status   Output    Cost(in/out)"
          const sep = "-".repeat(header.length)

          const rows = all.map((r) => {
            const outStr = r.output_limit > 0 ? fmt(r.output_limit) : "?"
            const costStr = r.cost_input > 0 || r.cost_output > 0
              ? `$${r.cost_input.toFixed(2)}/$${r.cost_output.toFixed(2)}`
              : "—"
            return (
              r.provider_id.padEnd(maxProv + 2) +
              r.model_id.padEnd(maxModel + 2) +
              `${r.status.padEnd(8)} ${outStr.padEnd(8)} ${costStr}`
            )
          })

          const filterNote = params.min_output_tokens
            ? `Filtered: output >= ${fmt(params.min_output_tokens)} tokens | `
            : ""

          return {
            title: `Model list (${all.length} models)`,
            metadata: { results: all.length, criteria: { ...params } },
            output: [
              `${filterNote}${all.length} models`,
              "",
              header,
              sep,
              ...rows,
              sep,
              "",
              "Output = max output tokens. Cost = per 1M input/output tokens.",
              "Use ai-call with model: '<model_id>' to target a specific model.",
            ].join("\n"),
          }
        }

        // ── Capability lookup mode ──
        if (!params.task) {
          return {
            title: "Capability lookup",
            metadata: { results: 0 },
            output: "Provide a `task` description or set `list_all: true` to list all models.",
          }
        }

        const lookup = yield* capability.lookup({ task: params.task, modality: params.modality }).pipe(
          Effect.matchEffect({
            onSuccess: (results) => Effect.succeed({ type: "success" as const, results }),
            onFailure: (error) => Effect.succeed({ type: "error" as const, error }),
          }),
        )

        if (lookup.type === "error") {
          return {
            title: `Capability lookup: ${params.task}`,
            metadata: { pattern: params.task, results: 0 },
            output: `Capability lookup failed: ${lookup.error.message}`,
          }
        }

        const results = lookup.results

        if (params.min_output_tokens) {
          // Filter by output limit — need provider models for this
          const providers = yield* provider.list()
          const limitMap = new Map<string, number>()
          for (const [provID, provInfo] of Object.entries(providers)) {
            for (const model of Object.values(provInfo.models)) {
              limitMap.set(`${provID}/${model.id}`, model.limit?.output ?? 0)
            }
          }
          const filtered = results.filter((r) => {
            const limit = limitMap.get(`${r.provider_id}/${r.model_id}`) ?? 0
            return limit >= params.min_output_tokens!
          })
          if (filtered.length === 0) {
            return {
              title: `Capability lookup: ${params.task}`,
              metadata: { results: 0, criteria: { ...params } },
              output: `No models matching "${params.task}" with output >= ${params.min_output_tokens} tokens. Try lowering min_output_tokens or broadening the task.`,
            }
          }
          results.length = 0
          results.push(...filtered)
        }

        if (results.length === 0) {
          return {
            title: `Capability lookup: ${params.task}`,
            metadata: { pattern: params.task, results: 0 },
            output:
              `No models found matching "${params.task}". Try broader keywords or check \`models_capabilities.yaml\` for available entries.`,
          }
        }

        // Fetch output limits for display
        const providers = yield* provider.list()
        const limitMap = new Map<string, number>()
        for (const [provID, provInfo] of Object.entries(providers)) {
          for (const model of Object.values(provInfo.models)) {
            limitMap.set(`${provID}/${model.id}`, model.limit?.output ?? 0)
          }
        }

        const maxModelLen = Math.max(...results.map((r) => r.model_id.length), 8)
        const maxProvLen = Math.max(...results.map((r) => r.provider_id.length), 8)

        const header =
          "Model".padEnd(maxModelLen + 2) +
          "Provider".padEnd(maxProvLen + 2) +
          "Status   Key    Output    Capabilities"
        const sep = "-".repeat(header.length)

        const rows = results.map((r) => {
          const si = r.provenance === "proven" ? "P" : r.provenance === "tested" ? "T" : "-"
          const sl = r.provenance.padEnd(7)
          const ki = r.has_api_key ? "Y" : "N"
          const outLimit = limitMap.get(`${r.provider_id}/${r.model_id}`)
          const outStr = outLimit && outLimit > 0
            ? outLimit >= 1_000_000
              ? `${(outLimit / 1_000_000).toFixed(1)}M`
              : `${(outLimit / 1_000).toFixed(0)}K`
            : "?"
          return (
            r.model_id.padEnd(maxModelLen + 2) +
            r.provider_id.padEnd(maxProvLen + 2) +
            `${si} ${sl} ${ki}    ${outStr.padEnd(8)} ${r.capabilities}`
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
          metadata: { pattern: params.task, results: results.length, criteria: { ...params } },
          output,
        }
      }),
  }
}))
